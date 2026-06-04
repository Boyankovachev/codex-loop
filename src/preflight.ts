import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { fail } from "./errors.js";

type StartupCheckStatus = "ok" | "warning" | "fail";

type StartupCheck = {
  name: string;
  status: StartupCheckStatus;
  summary: string;
  detail?: string;
};

export type StartupReport = {
  checks: StartupCheck[];
};

type DoctorReport = {
  overallStatus?: string;
  codexVersion?: string;
  checks?: Record<string, DoctorCheck>;
};

type DoctorCheck = {
  id?: string;
  status?: string;
  summary?: string;
  details?: Record<string, unknown>;
  remediation?: string | null;
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const require = createRequire(import.meta.url);
const REQUIRED_DOCTOR_CHECKS = ["config.load", "auth.credentials"] as const;
const ACCESS_DOCTOR_CHECKS = ["network.websocket_reachability", "network.provider_reachability"] as const;

export async function runStartupChecks(): Promise<StartupReport> {
  const checks: StartupCheck[] = [];

  const gitVersion = await runProcess("git", ["--version"]);
  checks.push({
    name: "git executable",
    status: gitVersion.exitCode === 0 ? "ok" : "fail",
    summary:
      gitVersion.exitCode === 0
        ? gitVersion.stdout.trim()
        : "git is not available on PATH or could not be executed.",
    detail: gitVersion.exitCode === 0 ? undefined : gitVersion.stderr.trimEnd(),
  });

  const codexPath = resolveCodexCliPath();
  if (!codexPath) {
    checks.push({
      name: "Codex CLI runtime",
      status: "fail",
      summary: "The @openai/codex CLI runtime could not be resolved from dependencies.",
      detail: "Run npm install in this project and try again.",
    });
    return { checks };
  }

  const codexVersion = await runProcess(process.execPath, [codexPath, "--version"]);
  checks.push({
    name: "Codex CLI runtime",
    status: codexVersion.exitCode === 0 ? "ok" : "fail",
    summary:
      codexVersion.exitCode === 0
        ? `${codexVersion.stdout.trim()} (${codexPath})`
        : "The bundled Codex CLI could not be executed.",
    detail: codexVersion.exitCode === 0 ? undefined : codexVersion.stderr.trimEnd(),
  });

  const doctorResult = await runProcess(process.execPath, [codexPath, "doctor", "--json"], 45_000);
  const doctor = parseDoctorReport(doctorResult.stdout);
  if (!doctor) {
    checks.push({
      name: "Codex doctor",
      status: "fail",
      summary: "Codex doctor did not return a readable JSON report.",
      detail: [doctorResult.stderr.trimEnd(), doctorResult.stdout.trimEnd()].filter(Boolean).join("\n"),
    });
    return { checks };
  }

  for (const id of REQUIRED_DOCTOR_CHECKS) {
    const check = doctor.checks?.[id];
    checks.push(toStartupCheck(`Codex ${id}`, check, check?.status === "ok"));
  }

  const accessChecks = ACCESS_DOCTOR_CHECKS.map((id) => doctor.checks?.[id]).filter(Boolean) as DoctorCheck[];
  const hasAccess = accessChecks.some((check) => check.status === "ok");
  checks.push({
    name: "Codex network/model access",
    status: hasAccess ? "ok" : "fail",
    summary: hasAccess
      ? accessChecks.map((check) => `${check.id ?? "access"}: ${check.summary ?? check.status}`).join("; ")
      : "Codex could not verify provider reachability or websocket access.",
    detail: hasAccess ? undefined : accessChecks.map(formatDoctorCheck).join("\n\n"),
  });

  for (const [id, check] of Object.entries(doctor.checks ?? {})) {
    if (
      check.status === "fail" &&
      !REQUIRED_DOCTOR_CHECKS.includes(id as (typeof REQUIRED_DOCTOR_CHECKS)[number]) &&
      !ACCESS_DOCTOR_CHECKS.includes(id as (typeof ACCESS_DOCTOR_CHECKS)[number])
    ) {
      checks.push(toStartupCheck(`Codex doctor warning: ${id}`, check, false, "warning"));
    }
  }

  return { checks };
}

export function assertStartupReportOk(report: StartupReport): void {
  const failures = report.checks.filter((check) => check.status === "fail");
  if (failures.length === 0) {
    return;
  }

  const body = failures
    .map((check) => {
      const detail = check.detail ? `\n${indent(check.detail)}` : "";
      return `- ${check.name}: ${check.summary}${detail}`;
    })
    .join("\n");

  fail(`Startup checks failed:\n${body}`);
}

export function formatStartupWarnings(report: StartupReport): string {
  const warnings = report.checks.filter((check) => check.status === "warning");
  if (warnings.length === 0) {
    return "";
  }

  return warnings
    .map((check) => `Startup warning: ${check.name}: ${check.summary}`)
    .join("\n");
}

function resolveCodexCliPath(): string | null {
  try {
    return require.resolve("@openai/codex/bin/codex.js");
  } catch {
    return null;
  }
}

function parseDoctorReport(stdout: string): DoctorReport | null {
  try {
    return JSON.parse(stdout) as DoctorReport;
  } catch {
    return null;
  }
}

function toStartupCheck(
  name: string,
  check: DoctorCheck | undefined,
  ok: boolean,
  fallbackStatus: StartupCheckStatus = "fail",
): StartupCheck {
  if (!check) {
    return {
      name,
      status: fallbackStatus,
      summary: "Check was not present in the Codex doctor report.",
    };
  }

  return {
    name,
    status: ok ? "ok" : fallbackStatus,
    summary: check.summary ?? `status=${check.status ?? "unknown"}`,
    detail: ok ? undefined : formatDoctorCheck(check),
  };
}

function formatDoctorCheck(check: DoctorCheck): string {
  return [
    `id: ${check.id ?? "(unknown)"}`,
    `status: ${check.status ?? "(unknown)"}`,
    `summary: ${check.summary ?? "(none)"}`,
    check.remediation ? `remediation: ${check.remediation}` : undefined,
    check.details ? `details: ${JSON.stringify(check.details, null, 2)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function runProcess(command: string, args: string[], timeoutMs = 30_000): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}Command timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}${error.message}` });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}
