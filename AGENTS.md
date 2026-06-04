# AGENTS.md

## Project Purpose

`codex-loop` is a local TypeScript CLI that orchestrates Codex SDK sessions for one feature or bugfix in one git repository. It runs a bounded workflow:

1. A persistent implementer Codex thread edits the target repo.
2. Local validation commands run in the target repo.
3. A fresh reviewer Codex thread reviews only the original issue, current git status, current diff, and validation output.
4. If review fails, findings go back to the original implementer thread.
5. The loop repeats until validation and review pass or `maxIterations` is reached.

The tool itself lives outside the target repo it modifies.

## Important Agent Rule

Whenever an AI agent changes this project, it must update this `AGENTS.md` file if the change affects project behavior, commands, architecture, safety rules, artifacts, configuration, or expected development workflow. Treat this file as required project documentation, not optional notes.

## Runtime Assumptions

- Node.js 18 or newer.
- `git` is available on `PATH`.
- The local machine has Codex authentication and model access for the configured model.
- The package dependencies are installed with `npm install`.
- The target repo is a git work tree.

The CLI performs startup checks before doing work:

- `git --version`
- bundled `@openai/codex` CLI resolution and `--version`
- `codex doctor --json` for Codex config, auth, and provider/network access
- target repo existence and git work tree status
- optional push target verification when `--push` is requested

Fatal startup failures should be reported with actionable details. Nonfatal Codex doctor failures are logged as startup warnings and written to run artifacts.

## Main Commands

Install dependencies:

```bash
npm install
```

Run the bundled local checks:

```bash
npm test
```

Typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Show CLI help:

```bash
npm run smoke
```

Run from source during development:

```bash
npm run dev -- run --repo "C:\Dplan-mono" --issue issue.md --validation "npm test"
```

Build and run the compiled CLI:

```bash
npm run build
node C:\codex-loop\dist\cli.js run --repo "C:\Dplan-mono" --issue issue.md
```

## CLI Behavior

The command shape is:

```bash
codex-loop run [options]
```

If `--repo` is omitted, the repo defaults to the config file repo or the current directory. If `--issue` and `--prompt` are both provided, their contents are combined. `--issue-text` remains available as a compatibility alias for `--prompt`, but new docs and examples should use `--prompt`.

Important options:

- `--config <path>`: JSON config file.
- `--repo <path>`: target git repository.
- `--issue <path>`: issue/task file.
- `--prompt <text>`: inline issue/task text.
- `--model <model>`: Codex model, default `gpt-5.5`.
- `--reasoning-effort <value>`: Codex reasoning effort, default `high`; allowed values are `minimal`, `low`, `medium`, `high`, and `xhigh`.
- `--max-iterations <number>`: bounded loop limit, default `5`.
- `--validation <command>`: validation command, repeatable.
- `--allow-dirty`: allow starting with target repo changes.
- `--allow-minor-findings`: accept reviewer pass with minor findings.
- `--commit`: commit final passing changes locally.
- `--push`: commit and push final passing changes to the active upstream branch.
- `--commit-and-push`: alias for `--push`.
- `--dry-run`: run startup and repo checks without Codex or validation turns.
- `--json`: emit final result JSON.

`--push` implies `--commit`. Commit/push defaults are false.

## Git Safety Rules

- Never run destructive git commands.
- Never auto-commit unless `--commit`, `--push`, or config equivalent is enabled.
- Never push unless `--push` or `commitAndPush` config is enabled.
- Refuse dirty target repos by default.
- Refuse commit/push if the target repo starts dirty, even with `--allow-dirty`, to avoid committing unrelated user work.
- Do not push from detached HEAD.
- Do not push without an upstream branch.
- Before pushing, fetch the upstream remote and compare `HEAD...@{u}`.
- If the upstream has commits not present locally, block the push and report that merge or rebase is needed.

## Code Structure

- `src/cli.ts`: entrypoint, top-level error handling, text vs JSON output.
- `src/config.ts`: CLI option parsing, config file loading, defaults.
- `src/runner.ts`: main implement, validate, review, repair loop.
- `src/preflight.ts`: startup checks for git, Codex runtime, Codex auth, and access.
- `src/git.ts`: git command helpers, repo checks, diff/status collection, push prerequisite checks.
- `src/git-actions.ts`: optional commit and push behavior after a clean pass.
- `src/prompts.ts`: implementer, reviewer, and repair prompts.
- `src/review-schema.ts`: strict reviewer JSON schema and runtime parser. Structured output schemas must mark every object property as required; reviewer findings use `file: ""` when no specific file applies.
- `src/validation.ts`: local validation command execution and formatting.
- `src/artifacts.ts`: run directory creation and artifact writing.
- `src/text-utils.ts`: output truncation helpers.
- `src/types.ts`: shared TypeScript types.

## Run Artifacts

Runs are written under `.codex-loop/runs/<timestamp>/` by default, outside the target repo when the CLI is invoked from inside that target repo.

Artifacts include:

- `issue.md`
- `config.json`
- `startup-checks.json`
- `initial-git-status.txt`
- `implementer-initial.md`
- per-attempt status, diff, validation, raw review, parsed review, and reviewer thread metadata
- `final-summary.md`
- `final-summary.json`

## Development Notes

- Use `apply_patch` for hand edits.
- Keep behavior conservative and explicit.
- Prefer deterministic local logic for git safety and commit messages.
- Keep reviewer context clean: do not leak implementer conversation into review prompts.
- Preserve the target repo except for intended Codex changes and explicitly requested commit/push actions.
- Run `npm run typecheck` and `npm run build` before handing off substantive code changes.
