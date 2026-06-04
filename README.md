# codex-loop

`codex-loop` is a local TypeScript CLI that uses the Codex SDK to run a bounded implement, validate, review, and repair loop for one task in one git repository.

The workflow uses two Codex roles:

- A persistent implementer thread with `workspace-write` access.
- A fresh reviewer thread on every attempt with `read-only` access.

The reviewer only sees the original issue, current git status, current diff, and validation output. If review fails, the findings are sent back to the original implementer thread and the loop continues until a clean pass or `maxIterations`.

## Install

```bash
npm install
npm run build
```

This assumes the local machine has Codex access and `git` on `PATH`. The CLI checks those prerequisites at startup and reports detailed failures before starting Codex work.

## Usage

From the project folder:

```bash
npm run dev -- run --repo "C:\Dplan-mono" --issue issue.md --validation "npm test"
```

With an inline prompt:

```bash
npm run dev -- run --repo "C:\Dplan-mono" --prompt "Fix the failing auth redirect test" --validation "npm test"
```

From another folder, either point npm at this project:

```bash
npm --prefix "C:\codex-loop" run dev -- run --repo "C:\Dplan-mono" --prompt "Fix the failing auth redirect test"
```

Or run the built file directly:

```bash
node "C:\codex-loop\dist\cli.js" run --repo "C:\Dplan-mono" --prompt "Fix the failing auth redirect test"
```

For a normal global-style command, link it once:

```bash
cd C:\codex-loop
npm link
```

Then run `codex-loop` from any folder:

```bash
cd C:\Dplan-mono
codex-loop run --prompt "Fix the failing auth redirect test" --validation "npm test"
```

## Flags

`--config <path>`

Loads a JSON config file. If omitted, the CLI automatically uses `codex-loop.config.json` from the current directory when it exists. Relative paths inside the config are resolved from the config file location.

`--repo <path>`

Sets the target git repository Codex should modify. If omitted, the target repo is the config file repo, or the current directory when no repo is configured.

`--issue <path>`

Reads the task prompt from a text or Markdown file. Use this for longer specs.

`--prompt <text>`

Passes the task prompt inline on the command line. `--issue-text` still works as a compatibility alias, but `--prompt` is the preferred flag.

`--model <model>`

Sets the Codex model for both implementer and reviewer sessions. Default: `gpt-5.4`.

`--max-iterations <number>`

Controls the maximum implement, validate, review, and repair attempts before the tool stops. Default: `5`.

`--validation <command>`

Runs a validation command inside the target repo after each implementer turn. You can repeat it to run multiple checks:

```text
--validation "npm test" --validation "npm run typecheck"
```

The command output and exit code are saved to artifacts and sent to the reviewer. If no validation command is provided, review still runs, but validation is treated as an empty passing set.

`--allow-dirty`

Allows the target repo to start with existing changes. Without this flag, the CLI refuses to run on a dirty repo. Commit/push still refuses dirty starts even with this flag to avoid committing unrelated work.

`--allow-minor-findings`

Allows a reviewer `pass` with only minor findings to count as accepted. By default, any finding, including minor, prevents a full pass.

`--runs-root <path>`

Sets where run artifacts are written. By default, artifacts go under `.codex-loop/runs` outside the target repo when needed.

`--max-diff-chars <number>`

Limits how much git diff text is sent to the reviewer. Large diffs are truncated while preserving important sections. Default: `120000`.

`--max-validation-chars <number>`

Limits how much validation output is sent to the reviewer. Large output is truncated while preserving likely errors, stack traces, and summaries. Default: `60000`.

`--commit`

After validation and clean review pass, stages all final changes and creates a local commit with a generated commit message. Default: off.

`--push`

Implies `--commit`, then pushes the resulting commit to the current branch's configured upstream. If the branch is behind or diverged and merge/rebase is needed, the push is blocked and reported. Default: off.

`--commit-and-push`

Alias for `--push`.

`--dry-run`

Runs startup checks and repo safety checks, then exits before Codex implementation, validation, or review sessions.

`--json`

Prints the final result as JSON instead of human-readable text. Artifacts are still written.

By default the tool refuses to start if the target repo is dirty. It never commits or pushes changes unless explicitly requested.

## Startup Checks

Before running the workflow, `codex-loop` checks:

- `git --version`
- the bundled Codex CLI runtime from `@openai/codex`
- Codex config, auth, and provider/network access through `codex doctor --json`
- target repo existence and git work tree status
- push target access when `--push` is requested

Fatal failures stop the run with details and suggested remediation where Codex provides it. Nonfatal Codex doctor failures are logged as warnings and written to `startup-checks.json`.

## Commit and Push

Commit and push are opt-in:

```bash
npm run dev -- run --repo "C:\Dplan-mono" --issue issue.md --validation "npm test" --commit
```

```bash
npm run dev -- run --repo "C:\Dplan-mono" --issue issue.md --validation "npm test" --push
```

`--push` implies `--commit`. `--commit-and-push` is an alias for `--push`.

When commit is enabled, the CLI generates a commit message from the issue and changed files after validation and clean review pass. When push is enabled, it pushes to the current branch's configured upstream only if the branch is not behind or diverged. If merge or rebase is needed, the push is blocked and reported.

For safety, commit/push is refused if the target repo starts dirty, even when `--allow-dirty` is set.

## Artifacts

Each run writes artifacts outside the target repo by default:

```text
.codex-loop/runs/<timestamp>/
  issue.md
  config.json
  startup-checks.json
  initial-git-status.txt
  implementer-initial.md
  attempts/
    01-git-status.txt
    01-git-diff.patch
    01-validation.txt
    01-validation.json
    01-review-raw.txt
    01-review.json
    01-review-thread.json
  final-summary.md
  final-summary.json
```

If you run the CLI from inside the target repo, the default artifacts path is moved to a sibling `.codex-loop` directory so the target repo stays clean except for intended source changes.
