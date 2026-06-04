const IMPORTANT_LINE_PATTERN =
  /\b(error|failed|failure|failures|exception|stack|traceback|expected|received|assert|ts\d{4}|eslint|warning|summary|tests?|suites?|panic)\b|:\d+:\d+|^\s+at\s+/i;

export function truncateSmart(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const marker = `[truncated from ${text.length} characters to ${maxChars} characters]`;
  const remainingBudget = Math.max(0, maxChars - marker.length - 64);
  const headBudget = Math.floor(remainingBudget * 0.25);
  const importantBudget = Math.floor(remainingBudget * 0.35);
  const tailBudget = remainingBudget - headBudget - importantBudget;

  const importantLines = text
    .split(/\r?\n/)
    .filter((line) => IMPORTANT_LINE_PATTERN.test(line))
    .slice(-200)
    .join("\n");

  const parts = [
    marker,
    "",
    "--- head ---",
    text.slice(0, headBudget).trimEnd(),
    "",
    "--- important lines ---",
    truncateMiddle(importantLines || "(no important lines matched)", importantBudget),
    "",
    "--- tail ---",
    text.slice(Math.max(0, text.length - tailBudget)).trimStart(),
  ];

  return parts.join("\n");
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const marker = "\n[...]\n";
  const half = Math.max(0, Math.floor((maxChars - marker.length) / 2));
  return `${text.slice(0, half)}${marker}${text.slice(text.length - half)}`;
}
