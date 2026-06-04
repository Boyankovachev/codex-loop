import type { LoopConfig, ReviewResult, ValidationSummary } from "./types.js";
import { truncateSmart } from "./text-utils.js";
import { formatValidationForPrompt } from "./validation.js";

export function buildInitialPrompt(config: LoopConfig): string {
  return `You are the implementation session for a bounded Codex auto-feature workflow.

Implement the requested task in this git repository. Make the smallest coherent set of source changes needed.

Constraints:
- Do not commit changes.
- Do not run destructive git commands.
- Preserve unrelated existing user changes.
- Keep scope limited to the original issue.
- Run focused local checks when they are useful, but the orchestrator will run configured validation after your turn.
- If blocked by missing credentials or unavailable external services, leave the repo in the best safe state and explain the blocker.

Original issue:
${config.issue}

At the end, summarize changed files and recommended validation.`;
}

export function buildReviewPrompt(args: {
  issue: string;
  gitStatus: string;
  gitDiff: string;
  validation: ValidationSummary;
  maxDiffChars: number;
  maxValidationChars: number;
}): string {
  const diff = args.gitDiff.trim().length > 0 ? args.gitDiff : "(no git diff)";
  const status = args.gitStatus.trim().length > 0 ? args.gitStatus : "(clean)";

  return `You are a clean-session reviewer with read-only access to the repository at the working directory.

You are an active agent, not a passive diff reader. The diff below is a starting point, not the full picture.
Investigate the actual repository before reporting:
- Open the changed files and read the surrounding code, not just the diff hunks.
- Read related files the change depends on or affects (callers, types, tests, config).
- Search the codebase (grep/ripgrep, file listing) to confirm a finding is real before reporting it.
- Run read-only checks when useful to verify behavior (for example: type lookups, focused test reads, git history).
You may run commands and read any file. You must not modify files, write to disk, or access the network.
Prefer verified findings grounded in the real repository state over guesses from the diff alone.

Review the implementation for correctness, regressions, missing tests, scope creep, and validation quality.

Your final message must be only JSON matching the provided schema. Do not wrap it in Markdown.
You may run tool calls while investigating, but the final response must contain nothing but the JSON.
Every finding must include a string file field. Use an empty string when no specific file applies.

Severity guidance:
- blocker: must be fixed before accepting.
- important: likely bug, regression, or significant missing validation.
- minor: low-risk polish or follow-up.

Original issue:
${args.issue}

Git status:
${status}

Git diff:
${truncateSmart(diff, args.maxDiffChars)}

Validation commands and output:
${formatValidationForPrompt(args.validation, args.maxValidationChars)}
`;
}

export function buildRepairPrompt(args: {
  issue: string;
  review: ReviewResult;
  validation: ValidationSummary;
}): string {
  return `A clean review found issues. Fix only these issues while preserving the original task.

Original issue:
${args.issue}

Review findings:
${JSON.stringify(args.review, null, 2)}

Latest validation output:
${formatValidationForPrompt(args.validation, 60_000)}

After edits, summarize changed files and recommended validation.`;
}
