const MAX_SUMMARY_CHARS = 2_200;
const MAX_ACTION_LINES = 8;
const MAX_ACTION_LINE_CHARS = 260;
const ACTION_START = /^(?:add|apply|build|change|check|compare|configure|confirm|create|debug|document|fix|implement|inspect|keep|preserve|remove|replace|review|run|test|update|use|verify|write)\b/i;
const ACTION_HEADING = /\b(action|next step|next steps|recommend|implementation|verification|todo|plan)\b/i;
const ACTION_HINT = /\b(?:should|must|need to|do not|don't|recommend(?:s|ed)?|i would|prefer)\b/i;
const REVIEW_REQUIRED = /\b(delete|destroy|drop|force|credential|secret|password|token|deploy|publish|send|purchase|payment|reset)\b/i;

function cleanLine(line) {
  return String(line || "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isActionLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || /^```/.test(trimmed)) return false;
  if (trimmed.length > 600) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return ACTION_HEADING.test(trimmed);
  if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed)) return true;
  return ACTION_START.test(trimmed) || ACTION_HINT.test(trimmed) || trimmed.endsWith("?");
}

function extractActionLines(assistantText) {
  const actions = [];
  const seen = new Set();
  let inFence = false;
  for (const line of String(assistantText || "").split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !isActionLine(line)) continue;
    const action = cleanLine(line);
    if (!action) continue;
    const key = action.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(action.length > MAX_ACTION_LINE_CHARS
      ? `${action.slice(0, MAX_ACTION_LINE_CHARS - 1).trimEnd()}…`
      : action);
    if (actions.length >= MAX_ACTION_LINES) break;
  }
  return actions;
}

function safePath(path) {
  return String(path || "").replaceAll("`", "'");
}

function capSummary(lines) {
  const output = lines.join("\n");
  if (output.length <= MAX_SUMMARY_CHARS) return `${output}\n`;
  return `${output.slice(0, MAX_SUMMARY_CHARS - 2).trimEnd()}…\n`;
}

export function renderActionSummary({ assistantText = "", receipt = {} } = {}) {
  const charCount = Number(receipt.response?.charCount) || String(assistantText).length;
  const artifacts = receipt.artifacts || {};
  const lines = ["## ChatGPT guidance summary", ""];
  if (receipt.ok) {
    lines.push(`- Response captured: ${charCount} chars.`);
  } else {
    lines.push(`- Call failed: ${receipt.errorCode || "unknown"}.`);
  }

  const actions = extractActionLines(assistantText);
  if (actions.length) {
    lines.push("", "### Candidate next actions");
    for (const action of actions) {
      lines.push(`- ${REVIEW_REQUIRED.test(action) ? "Review before execution: " : ""}${action}`);
    }
  } else if (receipt.ok) {
    lines.push("", "- No structured action lines were detected; read the complete assistant artifact before acting.");
  } else {
    lines.push("", "- No assistant response was captured.");
  }

  lines.push(
    "",
    "- Next Codex step: read the full answer, validate each action against scope and AGENTS.md, execute only safe in-scope work, and verify it.",
  );
  if (artifacts.assistant) lines.push(`- Full answer: \`${safePath(artifacts.assistant)}\``);
  if (artifacts.transcript) lines.push(`- Full transcript: \`${safePath(artifacts.transcript)}\``);
  if (artifacts.receipt) lines.push(`- Receipt: \`${safePath(artifacts.receipt)}\``);
  return capSummary(lines);
}

export function actionSummaryLimit() {
  return MAX_SUMMARY_CHARS;
}
