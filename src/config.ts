import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelReasoningEffort } from "@openai/codex-sdk";

import { fail } from "./errors.js";
import type { ConfigFile, LoopConfig } from "./types.js";
import { isPathInside } from "./path-utils.js";

type RawCliOptions = {
  command?: string;
  configPath?: string;
  repo?: string;
  issuePath?: string;
  prompt?: string;
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  maxIterations?: number;
  validationCommands?: string[];
  allowDirty?: boolean;
  dryRun?: boolean;
  json?: boolean;
  runsRoot?: string;
  allowMinorFindings?: boolean;
  maxDiffChars?: number;
  maxValidationChars?: number;
  commit?: boolean;
  push?: boolean;
  commitAndPush?: boolean;
};

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_MODEL_REASONING_EFFORT: ModelReasoningEffort = "high";
const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_DIFF_CHARS = 120_000;
const DEFAULT_MAX_VALIDATION_CHARS = 60_000;
const MODEL_REASONING_EFFORTS = new Set<ModelReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

export async function loadCliConfig(argv: string[], cwd: string): Promise<LoopConfig> {
  const cli = parseArgs(argv);

  if (cli.command !== "run") {
    fail(`Unknown command "${cli.command ?? ""}".\n\n${usage()}`);
  }

  const configPath = resolveConfigPath(cli.configPath, cwd);
  const fileConfig = configPath ? await readConfigFile(configPath) : {};
  const configDir = configPath ? path.dirname(configPath) : cwd;

  const repoFromConfig = fileConfig.repo ? String(fileConfig.repo) : undefined;
  const repo = cli.repo ? path.resolve(cwd, cli.repo) : path.resolve(configDir, repoFromConfig ?? ".");

  const issue = await loadIssue({
    cwd,
    issuePath: cli.issuePath,
    prompt: cli.prompt,
  });

  const validationCommands =
    cli.validationCommands ??
    normalizeStringArray(fileConfig.validationCommands, "validationCommands") ??
    [];

  const maxIterations =
    cli.maxIterations ?? normalizePositiveInteger(fileConfig.maxIterations, "maxIterations") ?? DEFAULT_MAX_ITERATIONS;

  const runsRootInput = cli.runsRoot ?? stringOrUndefined(fileConfig.runsRoot, "runsRoot");
  const runsRoot = runsRootInput
    ? path.resolve(cli.runsRoot ? cwd : configDir, runsRootInput)
    : defaultRunsRoot({ cwd, repo });
  const commitAndPush =
    cli.commitAndPush ?? booleanOrUndefined(fileConfig.commitAndPush, "commitAndPush") ?? false;
  const push = cli.push ?? booleanOrUndefined(fileConfig.push, "push") ?? commitAndPush;
  const commit = (cli.commit ?? booleanOrUndefined(fileConfig.commit, "commit") ?? false) || commitAndPush || push;

  return {
    repo,
    issue,
    issuePath: cli.issuePath ? path.resolve(cwd, cli.issuePath) : undefined,
    configPath,
    model: cli.model ?? stringOrUndefined(fileConfig.model, "model") ?? DEFAULT_MODEL,
    modelReasoningEffort:
      cli.modelReasoningEffort ??
      modelReasoningEffortOrUndefined(fileConfig.modelReasoningEffort, "modelReasoningEffort") ??
      DEFAULT_MODEL_REASONING_EFFORT,
    maxIterations,
    validationCommands,
    allowDirty: cli.allowDirty ?? booleanOrUndefined(fileConfig.allowDirty, "allowDirty") ?? false,
    dryRun: cli.dryRun ?? booleanOrUndefined(fileConfig.dryRun, "dryRun") ?? false,
    json: cli.json ?? booleanOrUndefined(fileConfig.json, "json") ?? false,
    runsRoot,
    allowMinorFindings:
      cli.allowMinorFindings ?? booleanOrUndefined(fileConfig.allowMinorFindings, "allowMinorFindings") ?? false,
    maxDiffChars:
      cli.maxDiffChars ?? normalizePositiveInteger(fileConfig.maxDiffChars, "maxDiffChars") ?? DEFAULT_MAX_DIFF_CHARS,
    maxValidationChars:
      cli.maxValidationChars ??
      normalizePositiveInteger(fileConfig.maxValidationChars, "maxValidationChars") ??
      DEFAULT_MAX_VALIDATION_CHARS,
    commit,
    push,
    approvalPolicy: "never",
    implementerSandbox: "workspace-write",
    reviewerSandbox: "read-only",
  };
}

export function usage(): string {
  return `codex-loop

Usage:
  codex-loop run --issue issue.md --config codex-loop.config.json
  codex-loop run --repo "C:\\Dplan-mono" --prompt "Fix the failing auth redirect test"

Options:
  --config <path>             JSON config file. Defaults to ./codex-loop.config.json when present.
  --repo <path>               Target git repository. Defaults to config repo or current directory.
  --issue <path>              Markdown/text file with the requested task.
  --prompt <text>             Inline requested task.
  --model <model>             Codex model. Default: ${DEFAULT_MODEL}
  --reasoning-effort <value>  Reasoning effort: minimal, low, medium, high, xhigh. Default: ${DEFAULT_MODEL_REASONING_EFFORT}
  --max-iterations <number>   Maximum implement/review attempts. Default: ${DEFAULT_MAX_ITERATIONS}
  --validation <command>      Validation command. May be repeated.
  --allow-dirty               Allow starting when the target repo already has changes.
  --allow-minor-findings      Allow reviewer status=pass with minor findings.
  --runs-root <path>          Directory where run artifacts are written.
  --max-diff-chars <number>   Diff character budget sent to reviewer. Default: ${DEFAULT_MAX_DIFF_CHARS}
  --max-validation-chars <n>  Validation output budget sent to reviewer. Default: ${DEFAULT_MAX_VALIDATION_CHARS}
  --commit                    Commit final passing changes. Default: false.
  --push                      Commit and push final passing changes to the current upstream branch. Default: false.
  --commit-and-push           Alias for --push.
  --dry-run                   Check configuration and git safety without running Codex or validation.
  --json                      Print final result as JSON.
  --help                      Show this help.
`;
}

function parseArgs(argv: string[]): RawCliOptions {
  const [command, ...rest] = argv;
  const options: RawCliOptions = { command };
  const validationCommands: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      fail(`Unexpected positional argument "${token}".`);
    }

    const [name, inlineValue] = splitOption(token);
    const readValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }

      const next = rest[index + 1];
      if (!next || next.startsWith("--")) {
        fail(`Missing value for ${name}.`);
      }
      index += 1;
      return next;
    };

    switch (name) {
      case "--config":
        options.configPath = readValue();
        break;
      case "--repo":
        options.repo = readValue();
        break;
      case "--issue":
        options.issuePath = readValue();
        break;
      case "--prompt":
        options.prompt = readValue();
        break;
      case "--issue-text":
        options.prompt = readValue();
        break;
      case "--model":
        options.model = readValue();
        break;
      case "--reasoning-effort":
        options.modelReasoningEffort = parseModelReasoningEffort(readValue(), name);
        break;
      case "--max-iterations":
        options.maxIterations = parsePositiveInteger(readValue(), name);
        break;
      case "--validation":
        validationCommands.push(readValue());
        break;
      case "--runs-root":
        options.runsRoot = readValue();
        break;
      case "--max-diff-chars":
        options.maxDiffChars = parsePositiveInteger(readValue(), name);
        break;
      case "--max-validation-chars":
        options.maxValidationChars = parsePositiveInteger(readValue(), name);
        break;
      case "--allow-dirty":
        rejectInlineValue(name, inlineValue);
        options.allowDirty = true;
        break;
      case "--dry-run":
        rejectInlineValue(name, inlineValue);
        options.dryRun = true;
        break;
      case "--json":
        rejectInlineValue(name, inlineValue);
        options.json = true;
        break;
      case "--allow-minor-findings":
        rejectInlineValue(name, inlineValue);
        options.allowMinorFindings = true;
        break;
      case "--commit":
        rejectInlineValue(name, inlineValue);
        options.commit = true;
        break;
      case "--push":
        rejectInlineValue(name, inlineValue);
        options.push = true;
        break;
      case "--commit-and-push":
        rejectInlineValue(name, inlineValue);
        options.commitAndPush = true;
        options.push = true;
        break;
      default:
        fail(`Unknown option "${name}".`);
    }
  }

  if (validationCommands.length > 0) {
    options.validationCommands = validationCommands;
  }

  return options;
}

function splitOption(token: string): [string, string | undefined] {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) {
    return [token, undefined];
  }
  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}

function rejectInlineValue(name: string, inlineValue: string | undefined): void {
  if (inlineValue !== undefined) {
    fail(`${name} does not accept a value.`);
  }
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseModelReasoningEffort(value: string, optionName: string): ModelReasoningEffort {
  if (MODEL_REASONING_EFFORTS.has(value as ModelReasoningEffort)) {
    return value as ModelReasoningEffort;
  }

  fail(`${optionName} must be one of: ${Array.from(MODEL_REASONING_EFFORTS).join(", ")}.`);
}

function resolveConfigPath(configPath: string | undefined, cwd: string): string | undefined {
  if (configPath) {
    return path.resolve(cwd, configPath);
  }

  const defaultPath = path.join(cwd, "codex-loop.config.json");
  return existsSync(defaultPath) ? defaultPath : undefined;
}

async function readConfigFile(configPath: string): Promise<ConfigFile> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as ConfigFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Failed to read config file ${configPath}: ${message}`);
  }
}

async function loadIssue(args: {
  cwd: string;
  issuePath?: string;
  prompt?: string;
}): Promise<string> {
  const parts: string[] = [];

  if (args.issuePath) {
    const resolved = path.resolve(args.cwd, args.issuePath);
    try {
      parts.push(await readFile(resolved, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`Failed to read issue file ${resolved}: ${message}`);
    }
  }

  if (args.prompt) {
    parts.push(args.prompt);
  }

  if (parts.length === 0) {
    fail("Provide --issue <path> or --prompt <text>.");
  }

  return parts.join("\n\n").trim();
}

function normalizeStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`Config field ${name} must be an array of strings.`);
  }

  return value;
}

function normalizePositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(`Config field ${name} must be a positive integer.`);
  }

  return value;
}

function stringOrUndefined(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    fail(`Config field ${name} must be a string.`);
  }

  return value;
}

function modelReasoningEffortOrUndefined(value: unknown, name: string): ModelReasoningEffort | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    fail(`Config field ${name} must be a string.`);
  }

  return parseModelReasoningEffort(value, name);
}

function booleanOrUndefined(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    fail(`Config field ${name} must be a boolean.`);
  }

  return value;
}

function defaultRunsRoot(args: { cwd: string; repo: string }): string {
  const cwdCandidate = path.resolve(args.cwd, ".codex-loop", "runs");
  if (!isPathInside(cwdCandidate, args.repo)) {
    return cwdCandidate;
  }

  return path.resolve(path.dirname(args.repo), ".codex-loop", "runs", path.basename(args.repo));
}
