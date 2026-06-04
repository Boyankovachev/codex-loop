import { Codex } from "@openai/codex-sdk";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createRunArtifacts,
  writeAttemptEvidence,
  writeAttemptImplementerArtifact,
  writeFinalSummary,
  writeImplementerArtifact,
  writeReviewArtifacts,
} from "./artifacts.js";
import { assertPushPrerequisites, commitAndMaybePush } from "./git-actions.js";
import { assertRepoReady, gitChangedFiles, gitDiff, gitStatus } from "./git.js";
import { fail } from "./errors.js";
import { assertStartupReportOk, formatStartupWarnings, runStartupChecks } from "./preflight.js";
import { buildInitialPrompt, buildRepairPrompt, buildReviewPrompt } from "./prompts.js";
import { parseReviewResult, reviewSchema } from "./review-schema.js";
import type { GitActionResult, LoopAttemptResult, LoopConfig, LoopResult, ReviewResult } from "./types.js";
import { runValidationCommands } from "./validation.js";

type Logger = (message: string) => void;

export async function runLoop(config: LoopConfig, log: Logger): Promise<LoopResult> {
  log("Running startup checks.");
  const startupReport = await runStartupChecks();
  assertStartupReportOk(startupReport);
  const startupWarnings = formatStartupWarnings(startupReport);
  if (startupWarnings.length > 0) {
    log(startupWarnings);
  }

  log(`Checking target repo: ${config.repo}`);
  const initialStatus = await assertRepoReady(config.repo, config.allowDirty);
  if ((config.commit || config.push) && initialStatus.trim().length > 0) {
    fail(
      [
        "Cannot use --commit or --push when the target repo starts dirty.",
        "This prevents pre-existing user changes from being committed by automation.",
        "Start from a clean repo, or run without commit/push.",
        "",
        initialStatus.trimEnd(),
      ].join("\n"),
    );
  }

  if (config.push) {
    await assertPushPrerequisites(config.repo);
  }

  const artifacts = await createRunArtifacts(config);

  await writeFile(path.join(artifacts.runDir, "initial-git-status.txt"), initialStatus, "utf8");
  await writeFile(path.join(artifacts.runDir, "startup-checks.json"), `${JSON.stringify(startupReport, null, 2)}\n`, "utf8");
  log(`Run artifacts: ${artifacts.runDir}`);

  if (config.dryRun) {
    const finalGitStatus = await gitStatus(config.repo);
    const changedFiles = await gitChangedFiles(config.repo);
    const result: LoopResult = {
      status: "dry-run",
      reason: "Dry run completed before Codex or validation execution.",
      runDir: artifacts.runDir,
      attempts: [],
      finalGitStatus,
      changedFiles,
      implementerThreadId: null,
    };
    await persistFinalResult(artifacts.runDir, result);
    return result;
  }

  const codex = new Codex();
  const implementer = codex.startThread({
    workingDirectory: config.repo,
    sandboxMode: config.implementerSandbox,
    approvalPolicy: config.approvalPolicy,
    model: config.model,
    modelReasoningEffort: config.modelReasoningEffort,
  });

  log("Starting implementer turn 1.");
  const initialTurn = await implementer.run(buildInitialPrompt(config));
  await writeImplementerArtifact({
    artifacts,
    filename: "implementer-initial.md",
    finalResponse: initialTurn.finalResponse,
    threadId: implementer.id,
  });

  const attempts: LoopAttemptResult[] = [];
  let terminalReason = "";

  for (let attempt = 1; attempt <= config.maxIterations; attempt += 1) {
    log(`Attempt ${attempt}/${config.maxIterations}: running validation.`);
    const validation = await runValidationCommands(config.validationCommands, config.repo);
    const currentStatus = await gitStatus(config.repo);
    const currentDiff = await gitDiff(config.repo);

    await writeAttemptEvidence({
      artifacts,
      attempt,
      gitStatus: currentStatus,
      gitDiff: currentDiff,
      validation,
    });

    log(`Attempt ${attempt}/${config.maxIterations}: starting clean reviewer thread.`);
    const reviewer = codex.startThread({
      workingDirectory: config.repo,
      sandboxMode: config.reviewerSandbox,
      approvalPolicy: config.approvalPolicy,
      model: config.model,
      modelReasoningEffort: config.modelReasoningEffort,
    });

    const reviewTurn = await reviewer.run(
      buildReviewPrompt({
        issue: config.issue,
        gitStatus: currentStatus,
        gitDiff: currentDiff,
        validation,
        maxDiffChars: config.maxDiffChars,
        maxValidationChars: config.maxValidationChars,
      }),
      { outputSchema: reviewSchema },
    );

    let review: ReviewResult | undefined;
    let parseError: string | undefined;
    try {
      review = parseReviewResult(reviewTurn.finalResponse);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    await writeReviewArtifacts({
      artifacts,
      attempt,
      rawReview: reviewTurn.finalResponse,
      review,
      reviewerThreadId: reviewer.id,
      parseError,
    });

    if (!review) {
      terminalReason = `Reviewer returned invalid JSON on attempt ${attempt}: ${parseError ?? "unknown parse error"}`;
      attempts.push({
        attempt,
        validationPassed: validation.passed,
        reviewStatus: "invalid-json",
        findings: [],
        passed: false,
      });
      break;
    }

    const passed = isAttemptPassed(review, validation.passed, config.allowMinorFindings);
    attempts.push({
      attempt,
      validationPassed: validation.passed,
      reviewStatus: review.status,
      findings: review.findings,
      passed,
    });

    if (passed) {
      terminalReason = `Validation and clean review passed on attempt ${attempt}.`;
      break;
    }

    if (attempt === config.maxIterations) {
      terminalReason = `Reached max iterations (${config.maxIterations}) without a clean pass.`;
      break;
    }

    log(`Attempt ${attempt}/${config.maxIterations}: sending findings back to implementer.`);
    const repairTurn = await implementer.run(
      buildRepairPrompt({
        issue: config.issue,
        review,
        validation,
      }),
    );
    await writeAttemptImplementerArtifact({
      artifacts,
      attempt,
      finalResponse: repairTurn.finalResponse,
      threadId: implementer.id,
    });
  }

  let status: LoopResult["status"] = attempts.some((attempt) => attempt.passed) ? "passed" : "failed";
  let gitAction: GitActionResult | undefined;

  if (status === "passed" && (config.commit || config.push)) {
    log(config.push ? "Committing and pushing final passing changes." : "Committing final passing changes.");
    gitAction = await commitAndMaybePush({ config, attempts });
    if (gitAction.status === "blocked" || gitAction.status === "failed") {
      status = "failed";
      terminalReason = `${terminalReason} Post-run git action did not complete: ${gitAction.reason}`;
    }
  }

  const postActionGitStatus = await gitStatus(config.repo);
  const changedFiles = await gitChangedFiles(config.repo);

  const result: LoopResult = {
    status,
    reason: terminalReason,
    runDir: artifacts.runDir,
    attempts,
    finalGitStatus: postActionGitStatus,
    changedFiles,
    implementerThreadId: implementer.id,
    gitAction,
  };

  await persistFinalResult(artifacts.runDir, result);
  return result;
}

export function renderResult(result: LoopResult): string {
  const lines = [
    `Status: ${result.status}`,
    `Reason: ${result.reason}`,
    `Run artifacts: ${result.runDir}`,
    `Implementer thread: ${result.implementerThreadId ?? "(none)"}`,
    "",
    "Attempts:",
  ];

  if (result.attempts.length === 0) {
    lines.push("- none");
  } else {
    for (const attempt of result.attempts) {
      lines.push(
        `- ${attempt.attempt}: validation=${attempt.validationPassed ? "pass" : "fail"}, review=${attempt.reviewStatus}, accepted=${attempt.passed ? "yes" : "no"}, findings=${attempt.findings.length}`,
      );
    }
  }

  lines.push("", "Changed files:");
  if (result.changedFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const file of result.changedFiles) {
      lines.push(`- ${file}`);
    }
  }

  if (result.finalGitStatus.trim().length > 0) {
    lines.push("", "Final git status:", result.finalGitStatus.trimEnd());
  }

  if (result.gitAction) {
    lines.push(
      "",
      "Git action:",
      `Status: ${result.gitAction.status}`,
      `Reason: ${result.gitAction.reason}`,
    );
    if (result.gitAction.commitHash) {
      lines.push(`Commit: ${result.gitAction.commitHash}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function isAttemptPassed(review: ReviewResult, validationPassed: boolean, allowMinorFindings: boolean): boolean {
  if (!validationPassed || review.status !== "pass") {
    return false;
  }

  return review.findings.every((finding) => {
    if (finding.severity === "blocker" || finding.severity === "important") {
      return false;
    }

    return allowMinorFindings || finding.severity !== "minor";
  });
}

async function persistFinalResult(runDir: string, result: LoopResult): Promise<void> {
  const markdown = renderResult(result);
  await writeFinalSummary({
    artifacts: { runDir, attemptsDir: path.join(runDir, "attempts") },
    markdown,
    json: result,
  });
}
