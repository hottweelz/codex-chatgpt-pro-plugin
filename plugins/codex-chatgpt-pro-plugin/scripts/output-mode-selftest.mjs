import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRunEnvelope } from "../src/chatgpt/run-envelope.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-output-mode-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-output-mode-home-"));

function run(script, echo) {
  const result = spawnSync(process.execPath, [resolve(packageRoot, "scripts", script), "--no-repo-context", "--prompt=fixture"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: repo,
      CHATGPT_PRO_HOME: home,
      CHATGPT_REPO_CONTEXT_MODE: "off",
      CHATGPT_THREAD_ECHO: echo,
      CHROME_REMOTE_DEBUGGING_PORT: "9",
      CHATGPT_LOCK_TIMEOUT_MS: "100",
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.notEqual(result.status, 0, `${script} should fail closed without CDP`);
  const receiptPath = result.stdout.match(/ChatGPT call receipt: (.+)/)?.[1]?.trim()
    || result.stdout.match(/"receipt":\s*"([^"]+)"/)?.[1];
  assert.ok(receiptPath, `${script} did not report a receipt path:\n${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(existsSync(receipt.artifacts.actionSummary), true);
  assert.equal(existsSync(receipt.artifacts.transcript), true);
  assert.equal(verifyRunEnvelope({ receiptPath }).ok, true);
  return { result, receipt, receiptPath };
}

try {
  const summaryCall = run("chatgpt-call.mjs", "summary");
  assert.equal(summaryCall.receipt.threadEcho.mode, "summary");
  assert.match(summaryCall.result.stdout, /ChatGPT guidance summary/);
  assert.doesNotMatch(summaryCall.result.stdout, /## Message Sent To ChatGPT Pro/);

  const verboseCall = run("chatgpt-call.mjs", "1");
  assert.equal(verboseCall.receipt.threadEcho.mode, "enabled");
  assert.match(verboseCall.result.stdout, /## Message Sent To ChatGPT Pro/);

  const silentRead = run("chatgpt-read-current.mjs", "0");
  assert.equal(silentRead.receipt.threadEcho.mode, "disabled_by_env");
  assert.doesNotMatch(silentRead.result.stdout, /ChatGPT guidance summary/);
  assert.doesNotMatch(silentRead.result.stdout, /## Message Received From ChatGPT Pro/);

  const summaryRead = run("chatgpt-read-current.mjs", "summary");
  assert.equal(summaryRead.receipt.threadEcho.mode, "summary");
  assert.match(summaryRead.result.stdout, /"output": "summary"/);
  assert.doesNotMatch(summaryRead.result.stdout, /"project"/);
  assert.match(summaryRead.result.stdout, /ChatGPT guidance summary/);
  assert.doesNotMatch(summaryRead.result.stdout, /## Message Received From ChatGPT Pro/);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "output-modes" }, null, 2));
