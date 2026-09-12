import assert from "node:assert/strict";
import { renderActionSummary } from "../src/chatgpt/action-summary.mjs";

const longTail = "This thesis tail must not be copied into the Codex window. ".repeat(80);
const response = [
  "## Analysis",
  "The architecture is sound, but the current handoff hides the actionable work.",
  "",
  "## Recommended next steps",
  "1. Run npm test and record the result.",
  "2. Inspect the receipt and compare the before/after state.",
  "- Preserve the current browser room.",
  "The system should preserve the room and write a compact summary.",
  "",
  longTail,
].join("\n");

const summary = renderActionSummary({
  assistantText: response,
  receipt: {
    ok: true,
    response: { charCount: response.length },
    artifacts: {
      assistant: "/tmp/run/assistant.md",
      transcript: "/tmp/run/transcript.md",
      receipt: "/tmp/run/receipt.json",
    },
  },
});

assert.match(summary, /ChatGPT guidance summary/);
assert.match(summary, /Response captured: \d+ chars/);
assert.match(summary, /Run npm test and record the result/);
assert.match(summary, /Inspect the receipt and compare the before\/after state/);
assert.match(summary, /Preserve the current browser room/);
assert.match(summary, /The system should preserve the room and write a compact summary/);
assert.match(summary, /assistant\.md/);
assert.match(summary, /Next Codex step: read the full answer, validate each action/);
assert.ok(summary.length <= 2400, `summary too long: ${summary.length}`);
assert.doesNotMatch(summary, /This thesis tail must not be copied/);

const unsafeSummary = renderActionSummary({
  assistantText: "- Delete the old profile and deploy the change without review.",
  receipt: { ok: true, artifacts: {} },
});
assert.match(unsafeSummary, /Review before execution: Delete the old profile/);
assert.match(unsafeSummary, /validate each action against scope and AGENTS\.md/);

const proseOnly = renderActionSummary({
  assistantText: "A detailed explanation without headings or action bullets.",
  receipt: { ok: true, artifacts: {} },
});
assert.match(proseOnly, /No structured action lines were detected/);
assert.match(proseOnly, /read the complete assistant artifact/i);

const failed = renderActionSummary({
  assistantText: "",
  receipt: {
    ok: false,
    errorCode: "browser.target_not_found",
    error: "No matching page",
    artifacts: { receipt: "/tmp/run/receipt.json" },
  },
});
assert.match(failed, /Call failed: browser\.target_not_found/);
assert.match(failed, /No assistant response was captured/);

console.log(JSON.stringify({ ok: true, tested: "action-summary" }, null, 2));
