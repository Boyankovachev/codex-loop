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

```bash
npm run dev -- run --repo "C:\Dplan-mono" --issue issue.md --validation "npm test"
```

Inline issue text is also supported:

```bash
npm run dev -- run --repo "C:\Dplan-mono" --issue-text "Fix the failing auth redirect test" --validation "npm test"
```

Useful flags:

```text
--config <path>
--repo <path>
--issue <path>
--issue-text <text>
--model <model>
--max-iterations <number>
--validation <command>
--allow-dirty
--allow-minor-findings
--commit
--push
--commit-and-push
--dry-run
--json
```

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
