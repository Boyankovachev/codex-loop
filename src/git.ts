import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

import { fail } from "./errors.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_BUFFER = 100 * 1024 * 1024;

export type GitCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function assertRepoReady(repo: string, allowDirty: boolean): Promise<string> {
  let repoStat;
  try {
    repoStat = await stat(repo);
  } catch {
    fail(`Target repo path does not exist: ${repo}`);
  }

  if (!repoStat.isDirectory()) {
    fail(`Target repo path is not a directory: ${repo}`);
  }

  const insideWorkTree = (await git(["rev-parse", "--is-inside-work-tree"], repo)).trim();
  if (insideWorkTree !== "true") {
    fail(`Target path is not a git work tree: ${repo}`);
  }

  const status = await gitStatus(repo);
  if (status.trim().length > 0 && !allowDirty) {
    fail(
      [
        "Target repo is dirty. Commit, stash, or pass --allow-dirty.",
        "",
        status.trimEnd(),
      ].join("\n"),
    );
  }

  return status;
}

export async function gitStatus(repo: string): Promise<string> {
  return git(["status", "--short"], repo);
}

export async function gitDiff(repo: string): Promise<string> {
  const [unstaged, staged, untracked] = await Promise.all([
    git(["diff", "--", "."], repo),
    git(["diff", "--cached", "--", "."], repo),
    gitUntrackedFiles(repo),
  ]);

  const sections: string[] = [];

  if (unstaged.trim().length > 0) {
    sections.push(["# Unstaged diff", "", unstaged.trimEnd()].join("\n"));
  }

  if (staged.trim().length > 0) {
    sections.push(["# Staged diff", "", staged.trimEnd()].join("\n"));
  }

  if (untracked.trim().length > 0) {
    sections.push(
      ["# Untracked files (new files — read their contents from the working tree)", "", untracked.trimEnd()].join("\n"),
    );
  }

  return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
}

export async function gitChangedFiles(repo: string): Promise<string[]> {
  const status = await gitStatus(repo);
  return status
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export async function gitCurrentBranch(repo: string): Promise<string> {
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).trim();
  if (branch === "HEAD") {
    fail("Cannot commit or push from a detached HEAD checkout.");
  }
  return branch;
}

export async function gitUpstreamInfo(repo: string): Promise<{
  branch: string;
  upstream: string;
  remoteName: string;
  remoteBranch: string;
}> {
  const branch = await gitCurrentBranch(repo);
  const upstreamResult = await tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repo);
  if (upstreamResult.exitCode !== 0 || upstreamResult.stdout.trim().length === 0) {
    fail(`Current branch "${branch}" does not have an upstream branch configured.`);
  }

  const remoteNameResult = await tryGit(["config", `branch.${branch}.remote`], repo);
  const mergeRefResult = await tryGit(["config", `branch.${branch}.merge`], repo);
  const remoteName = remoteNameResult.stdout.trim();
  const mergeRef = mergeRefResult.stdout.trim();

  if (remoteNameResult.exitCode !== 0 || remoteName.length === 0 || mergeRefResult.exitCode !== 0 || mergeRef.length === 0) {
    fail(`Current branch "${branch}" has incomplete upstream configuration.`);
  }

  const remoteBranch = mergeRef.replace(/^refs\/heads\//, "");
  return {
    branch,
    upstream: upstreamResult.stdout.trim(),
    remoteName,
    remoteBranch,
  };
}

export async function assertPushPrerequisites(repo: string): Promise<void> {
  const upstream = await gitUpstreamInfo(repo);
  const access = await tryGit(["ls-remote", "--exit-code", "--heads", upstream.remoteName, upstream.remoteBranch], repo, {
    timeoutMs: 30_000,
  });
  if (access.exitCode !== 0) {
    fail(
      [
        "Cannot verify git push access for the current branch.",
        `Branch: ${upstream.branch}`,
        `Upstream: ${upstream.upstream}`,
        `Remote: ${upstream.remoteName}`,
        `Remote branch: ${upstream.remoteBranch}`,
        "",
        "git ls-remote output:",
        access.stderr.trimEnd() || access.stdout.trimEnd() || "(empty)",
      ].join("\n"),
    );
  }
}

export async function tryGit(
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_GIT_BUFFER,
      timeout: options.timeoutMs,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: number | string | null;
      stderr?: string;
      stdout?: string;
    };
    return {
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
    };
  }
}

async function gitUntrackedFiles(repo: string): Promise<string> {
  const output = await git(["ls-files", "--others", "--exclude-standard"], repo);
  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => `- ${file}`)
    .join("\n");
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await tryGit(args, cwd);
  if (result.exitCode === 0) {
    return result.stdout;
  }

  {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    fail(`git ${args.join(" ")} failed in ${cwd}:\n${details}`);
  }
}
