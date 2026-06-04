import {
  assertPushPrerequisites,
  gitChangedFiles,
  gitCurrentBranch,
  gitUpstreamInfo,
  tryGit,
} from "./git.js";
import type { GitActionResult, LoopConfig, LoopAttemptResult } from "./types.js";

export { assertPushPrerequisites };

export async function commitAndMaybePush(args: {
  config: LoopConfig;
  attempts: LoopAttemptResult[];
}): Promise<GitActionResult> {
  const requestedCommit = args.config.commit || args.config.push;
  const requestedPush = args.config.push;

  if (!requestedCommit && !requestedPush) {
    return {
      requestedCommit,
      requestedPush,
      status: "not-requested",
      reason: "Commit/push was not requested.",
    };
  }

  const changedFiles = await gitChangedFiles(args.config.repo);
  if (changedFiles.length === 0) {
    return {
      requestedCommit,
      requestedPush,
      status: "skipped",
      reason: "No git changes were present after the passing review.",
    };
  }

  const identity = await readGitIdentity(args.config.repo);
  if (!identity.ok) {
    return {
      requestedCommit,
      requestedPush,
      status: "failed",
      reason: identity.reason,
    };
  }

  const commitMessage = buildCommitMessage({
    issue: args.config.issue,
    attempts: args.attempts,
    changedFiles,
  });

  const add = await tryGit(["add", "--all"], args.config.repo);
  if (add.exitCode !== 0) {
    return failureResult(requestedCommit, requestedPush, "git add --all failed.", add.stderr || add.stdout);
  }

  const [subject, ...bodyParts] = commitMessage.split("\n\n");
  const commit = await tryGit(["commit", "-m", subject, ...bodyParts.flatMap((body) => ["-m", body])], args.config.repo);
  if (commit.exitCode !== 0) {
    return failureResult(requestedCommit, requestedPush, "git commit failed.", commit.stderr || commit.stdout);
  }

  const hashResult = await tryGit(["rev-parse", "--short", "HEAD"], args.config.repo);
  const commitHash = hashResult.exitCode === 0 ? hashResult.stdout.trim() : undefined;

  if (!requestedPush) {
    return {
      requestedCommit,
      requestedPush,
      status: "committed",
      reason: "Created a local commit after validation and clean review passed.",
      commitHash,
      commitMessage,
    };
  }

  const pushReadiness = await checkPushReadiness(args.config.repo);
  if (!pushReadiness.ok) {
    return {
      requestedCommit,
      requestedPush,
      status: "blocked",
      reason: pushReadiness.reason,
      commitHash,
      commitMessage,
    };
  }

  const push = await tryGit(["push"], args.config.repo);
  if (push.exitCode !== 0) {
    return failureResult(
      requestedCommit,
      requestedPush,
      "git push failed after the commit was created.",
      push.stderr || push.stdout,
      commitHash,
      commitMessage,
    );
  }

  return {
    requestedCommit,
    requestedPush,
    status: "pushed",
    reason: "Created a local commit and pushed it to the current upstream branch.",
    commitHash,
    commitMessage,
  };
}

async function readGitIdentity(repo: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [name, email] = await Promise.all([
    tryGit(["config", "--get", "user.name"], repo),
    tryGit(["config", "--get", "user.email"], repo),
  ]);

  const missing = [];
  if (name.exitCode !== 0 || name.stdout.trim().length === 0) {
    missing.push("user.name");
  }
  if (email.exitCode !== 0 || email.stdout.trim().length === 0) {
    missing.push("user.email");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Git commit identity is not configured (${missing.join(", ")}). Set it with git config before using --commit or --push.`,
    };
  }

  return { ok: true };
}

async function checkPushReadiness(repo: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const upstream = await gitUpstreamInfo(repo);
    const fetch = await tryGit(["fetch", upstream.remoteName], repo, { timeoutMs: 60_000 });
    if (fetch.exitCode !== 0) {
      return {
        ok: false,
        reason: `Could not fetch ${upstream.remoteName} before push. Output:\n${fetch.stderr || fetch.stdout}`,
      };
    }

    const counts = await tryGit(["rev-list", "--left-right", "--count", `HEAD...${upstream.upstream}`], repo);
    if (counts.exitCode !== 0) {
      return {
        ok: false,
        reason: `Could not compare local branch with ${upstream.upstream}. Output:\n${counts.stderr || counts.stdout}`,
      };
    }

    const [aheadText, behindText] = counts.stdout.trim().split(/\s+/);
    const behind = Number(behindText ?? "0");
    if (behind > 0) {
      const merge = await tryGit(["merge", "--no-edit", upstream.upstream], repo);
      if (merge.exitCode !== 0) {
        await tryGit(["merge", "--abort"], repo);
        return {
          ok: false,
          reason: `Push blocked: ${upstream.upstream} contains ${behind} commit(s) not present locally and they conflict with the local commit. The merge was aborted to keep the working tree clean; resolve the conflicts manually before pushing.\n${(merge.stderr || merge.stdout).trimEnd()}`,
        };
      }
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}

function buildCommitMessage(args: {
  issue: string;
  attempts: LoopAttemptResult[];
  changedFiles: string[];
}): string {
  const subject = toCommitSubject(args.issue);
  const acceptedAttempt = args.attempts.find((attempt) => attempt.passed);
  const body = [
    "Generated by codex-loop after validation and clean review passed.",
    "",
    `Attempts: ${args.attempts.length}`,
    acceptedAttempt ? `Accepted attempt: ${acceptedAttempt.attempt}` : undefined,
    "",
    "Changed files:",
    ...args.changedFiles.map((file) => `- ${file}`),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  return `${subject}\n\n${body}`;
}

function toCommitSubject(issue: string): string {
  const firstLine =
    issue
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*#\d.]+\s*/, ""))
      .find((line) => line.length > 0) ?? "Implement requested Codex task";

  const normalized = firstLine.replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  const prefixed = /^(add|fix|update|implement|create|remove|refactor|improve|support)\b/i.test(normalized)
    ? normalized
    : `Implement ${normalized}`;

  return prefixed.length <= 72 ? prefixed : prefixed.slice(0, 69).trimEnd();
}

function failureResult(
  requestedCommit: boolean,
  requestedPush: boolean,
  reason: string,
  detail: string,
  commitHash?: string,
  commitMessage?: string,
): GitActionResult {
  return {
    requestedCommit,
    requestedPush,
    status: "failed",
    reason: `${reason}\n${detail.trimEnd()}`,
    commitHash,
    commitMessage,
  };
}
