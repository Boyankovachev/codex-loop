import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  LoopConfig,
  ReviewResult,
  RunArtifacts,
  ValidationSummary,
} from "./types.js";
import { formatValidationArtifact } from "./validation.js";

export async function createRunArtifacts(config: LoopConfig): Promise<RunArtifacts> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(config.runsRoot, timestamp);
  const attemptsDir = path.join(runDir, "attempts");

  await mkdir(attemptsDir, { recursive: true });
  await writeFile(path.join(runDir, "issue.md"), config.issue, "utf8");
  await writeJson(path.join(runDir, "config.json"), serializableConfig(config));

  return { runDir, attemptsDir };
}

export async function writeAttemptEvidence(args: {
  artifacts: RunArtifacts;
  attempt: number;
  gitStatus: string;
  gitDiff: string;
  validation: ValidationSummary;
}): Promise<void> {
  const prefix = attemptPrefix(args.attempt);
  await Promise.all([
    writeFile(path.join(args.artifacts.attemptsDir, `${prefix}-git-status.txt`), args.gitStatus, "utf8"),
    writeFile(path.join(args.artifacts.attemptsDir, `${prefix}-git-diff.patch`), args.gitDiff, "utf8"),
    writeFile(
      path.join(args.artifacts.attemptsDir, `${prefix}-validation.txt`),
      formatValidationArtifact(args.validation),
      "utf8",
    ),
    writeJson(path.join(args.artifacts.attemptsDir, `${prefix}-validation.json`), args.validation),
  ]);
}

export async function writeReviewArtifacts(args: {
  artifacts: RunArtifacts;
  attempt: number;
  rawReview: string;
  review?: ReviewResult;
  reviewerThreadId: string | null;
  parseError?: string;
}): Promise<void> {
  const prefix = attemptPrefix(args.attempt);
  const writes = [
    writeFile(path.join(args.artifacts.attemptsDir, `${prefix}-review-raw.txt`), args.rawReview, "utf8"),
    writeJson(path.join(args.artifacts.attemptsDir, `${prefix}-review-thread.json`), {
      threadId: args.reviewerThreadId,
    }),
  ];

  if (args.review) {
    writes.push(writeJson(path.join(args.artifacts.attemptsDir, `${prefix}-review.json`), args.review));
  }

  if (args.parseError) {
    writes.push(
      writeFile(path.join(args.artifacts.attemptsDir, `${prefix}-review-parse-error.txt`), args.parseError, "utf8"),
    );
  }

  await Promise.all(writes);
}

export async function writeImplementerArtifact(args: {
  artifacts: RunArtifacts;
  filename: string;
  finalResponse: string;
  threadId: string | null;
}): Promise<void> {
  await writeFile(
    path.join(args.artifacts.runDir, args.filename),
    [
      `Thread ID: ${args.threadId ?? "(not assigned)"}`,
      "",
      args.finalResponse.trimEnd(),
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function writeAttemptImplementerArtifact(args: {
  artifacts: RunArtifacts;
  attempt: number;
  finalResponse: string;
  threadId: string | null;
}): Promise<void> {
  const prefix = attemptPrefix(args.attempt);
  await writeFile(
    path.join(args.artifacts.attemptsDir, `${prefix}-repair-response.md`),
    [
      `Thread ID: ${args.threadId ?? "(not assigned)"}`,
      "",
      args.finalResponse.trimEnd(),
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function writeFinalSummary(args: {
  artifacts: RunArtifacts;
  markdown: string;
  json: unknown;
}): Promise<void> {
  await Promise.all([
    writeFile(path.join(args.artifacts.runDir, "final-summary.md"), args.markdown, "utf8"),
    writeJson(path.join(args.artifacts.runDir, "final-summary.json"), args.json),
  ]);
}

export function attemptPrefix(attempt: number): string {
  return String(attempt).padStart(2, "0");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function serializableConfig(config: LoopConfig): Record<string, unknown> {
  const { issue, ...rest } = config;
  return {
    ...rest,
    issueLength: issue.length,
  };
}
