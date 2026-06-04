import type { ReviewResult } from "./types.js";

export const reviewSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["pass", "fail"] },
    summary: { type: "string" },
    validationAssessment: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["blocker", "important", "minor"],
          },
          category: {
            type: "string",
            enum: ["bug", "regression", "test", "typecheck", "scope", "quality"],
          },
          file: { type: "string" },
          issue: { type: "string" },
          recommendation: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["severity", "category", "file", "issue", "recommendation", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["status", "summary", "validationAssessment", "findings"],
  additionalProperties: false,
} as const;

const statuses = new Set(["pass", "fail"]);
const severities = new Set(["blocker", "important", "minor"]);
const categories = new Set(["bug", "regression", "test", "typecheck", "scope", "quality"]);

export function parseReviewResult(raw: string): ReviewResult {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Review response is not a JSON object.");
  }

  if (!statuses.has(String(parsed.status))) {
    throw new Error("Review response has invalid status.");
  }

  if (typeof parsed.summary !== "string") {
    throw new Error("Review response summary must be a string.");
  }

  if (typeof parsed.validationAssessment !== "string") {
    throw new Error("Review response validationAssessment must be a string.");
  }

  if (!Array.isArray(parsed.findings)) {
    throw new Error("Review response findings must be an array.");
  }

  for (const [index, finding] of parsed.findings.entries()) {
    if (!isRecord(finding)) {
      throw new Error(`Finding ${index + 1} is not an object.`);
    }

    if (!severities.has(String(finding.severity))) {
      throw new Error(`Finding ${index + 1} has invalid severity.`);
    }

    if (!categories.has(String(finding.category))) {
      throw new Error(`Finding ${index + 1} has invalid category.`);
    }

    for (const field of ["issue", "recommendation", "evidence"] as const) {
      if (typeof finding[field] !== "string") {
        throw new Error(`Finding ${index + 1} ${field} must be a string.`);
      }
    }

    if (typeof finding.file !== "string") {
      throw new Error(`Finding ${index + 1} file must be a string. Use an empty string when no file applies.`);
    }
  }

  return parsed as ReviewResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
