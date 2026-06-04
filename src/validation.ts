import { spawn } from "node:child_process";

import { truncateSmart } from "./text-utils.js";
import type { ValidationCommandResult, ValidationSummary } from "./types.js";

export async function runValidationCommands(commands: string[], repo: string): Promise<ValidationSummary> {
  const results: ValidationCommandResult[] = [];

  for (const command of commands) {
    results.push(await runValidationCommand(command, repo));
  }

  return {
    passed: results.every((result) => result.exitCode === 0),
    commands: results,
  };
}

export function formatValidationArtifact(summary: ValidationSummary): string {
  if (summary.commands.length === 0) {
    return "No validation commands configured.\n";
  }

  return summary.commands
    .map((result, index) => {
      const status = result.exitCode === 0 ? "PASS" : "FAIL";
      return [
        `# ${index + 1}. ${result.command}`,
        "",
        `Status: ${status}`,
        `Exit code: ${result.exitCode ?? "(none)"}`,
        `Signal: ${result.signal ?? "(none)"}`,
        `Duration: ${result.durationMs}ms`,
        "",
        "## stdout",
        result.stdout.trimEnd() || "(empty)",
        "",
        "## stderr",
        result.stderr.trimEnd() || "(empty)",
        "",
      ].join("\n");
    })
    .join("\n");
}

export function formatValidationForPrompt(summary: ValidationSummary, maxChars: number): string {
  const full = formatValidationArtifact(summary);
  return truncateSmart(full, maxChars);
}

function runValidationCommand(command: string, repo: string): Promise<ValidationCommandResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: repo,
      shell: true,
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      stderr += `${stderr.length > 0 ? "\n" : ""}${error.message}`;
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        command,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });
  });
}
