import type { ApprovalMode, SandboxMode } from "@openai/codex-sdk";

export type ConfigFile = {
  repo?: unknown;
  model?: unknown;
  maxIterations?: unknown;
  validationCommands?: unknown;
  allowDirty?: unknown;
  dryRun?: unknown;
  json?: unknown;
  runsRoot?: unknown;
  allowMinorFindings?: unknown;
  maxDiffChars?: unknown;
  maxValidationChars?: unknown;
  commit?: unknown;
  push?: unknown;
  commitAndPush?: unknown;
};

export type ReviewStatus = "pass" | "fail";
export type ReviewSeverity = "blocker" | "important" | "minor";
export type ReviewCategory = "bug" | "regression" | "test" | "typecheck" | "scope" | "quality";

export type ReviewFinding = {
  severity: ReviewSeverity;
  category: ReviewCategory;
  file?: string;
  issue: string;
  recommendation: string;
  evidence: string;
};

export type ReviewResult = {
  status: ReviewStatus;
  summary: string;
  validationAssessment: string;
  findings: ReviewFinding[];
};

export type ValidationCommandResult = {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type ValidationSummary = {
  passed: boolean;
  commands: ValidationCommandResult[];
};

export type LoopConfig = {
  repo: string;
  issue: string;
  issuePath?: string;
  configPath?: string;
  model: string;
  maxIterations: number;
  validationCommands: string[];
  allowDirty: boolean;
  dryRun: boolean;
  json: boolean;
  runsRoot: string;
  allowMinorFindings: boolean;
  maxDiffChars: number;
  maxValidationChars: number;
  commit: boolean;
  push: boolean;
  approvalPolicy: ApprovalMode;
  implementerSandbox: SandboxMode;
  reviewerSandbox: SandboxMode;
};

export type GitActionStatus = "not-requested" | "skipped" | "committed" | "pushed" | "blocked" | "failed";

export type GitActionResult = {
  requestedCommit: boolean;
  requestedPush: boolean;
  status: GitActionStatus;
  reason: string;
  commitHash?: string;
  commitMessage?: string;
};

export type RunArtifacts = {
  runDir: string;
  attemptsDir: string;
};

export type LoopAttemptResult = {
  attempt: number;
  validationPassed: boolean;
  reviewStatus: ReviewStatus | "invalid-json";
  findings: ReviewFinding[];
  passed: boolean;
};

export type LoopResult = {
  status: "passed" | "failed" | "dry-run";
  reason: string;
  runDir: string;
  attempts: LoopAttemptResult[];
  finalGitStatus: string;
  changedFiles: string[];
  implementerThreadId: string | null;
  gitAction?: GitActionResult;
};
