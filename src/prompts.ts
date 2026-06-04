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

  return `You are a clean-session reviewer. Do not modify files.

Review the implementation for correctness, regressions, missing tests, scope creep, and validation quality.

Return only JSON matching the provided schema. Do not wrap it in Markdown.
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
