import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectToPage, now } from "../src/cdp-client.mjs";
import { pageProbe, redactedProbe } from "../src/chatgpt-page.mjs";
import { waitForAssistantResponse } from "../src/chatgpt-composer.mjs";
import { connectToChatGptSession } from "../src/chatgpt-sessions.mjs";
import { acquireChatGptOperation } from "../src/chatgpt-operation.mjs";
import { renderActionSummary } from "../src/chatgpt/action-summary.mjs";
import { writeJson } from "../src/observe.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import {
  DEFAULT_CDP_PORT,
  DEFAULT_TARGET_URL,
  runDir as makeRunDir,
  runId as makeRunId,
} from "../src/runtime-config.mjs";
import { sealRunEnvelope, threadEchoMode } from "../src/chatgpt/run-envelope.mjs";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function compactReceipt(receipt) {
  return {
    output: "summary",
    ok: Boolean(receipt.ok),
    kind: receipt.kind || "read",
    errorCode: receipt.errorCode || null,
    error: receipt.error || null,
    conversationUrl: receipt.conversationUrl || receipt.roomTarget?.actualTargetUrl || null,
    title: receipt.title || receipt.sessionTarget?.title || null,
    response: receipt.response
      ? {
          textSha256: receipt.response.textSha256 || null,
          charCount: receipt.response.charCount || null,
          finishDetectedBy: receipt.response.finishDetectedBy || null,
        }
      : null,
    actionSummary: receipt.actionSummary || null,
    artifacts: receipt.artifacts || {},
    roomTarget: receipt.roomTarget || null,
    threadEcho: receipt.threadEcho || null,
    lock: receipt.lock
      ? {
          waitMs: receipt.lock.waitMs ?? null,
          heldMs: receipt.lock.heldMs ?? null,
          released: receipt.lock.released ?? null,
          staleLockDetected: receipt.lock.staleLockDetected ?? null,
          staleLockReclaimed: receipt.lock.staleLockReclaimed ?? null,
        }
      : null,
  };
}

const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const targetUrl = process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const session = arg("session") || arg("alias") || process.env.CHATGPT_SESSION || "";
const responseTimeoutMs = Number(process.env.CHATGPT_RESPONSE_TIMEOUT_MS || 480_000);
const stableMs = Number(process.env.CHATGPT_RESPONSE_STABLE_MS || 5_000);
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const noWaitForLock = flag("no-wait");
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const runId = `${makeRunId()}-chatgpt-read-current`;
const runDir = makeRunDir(runId);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const project = ensureProjectState();

let cdp = null;
let operationHandle = null;
let assistantText = "";
let envelope = null;
const threadOutputMode = threadEchoMode();
const stdoutThreadEcho = threadOutputMode === "enabled";
const stdoutActionSummary = threadOutputMode === "summary";
const started = now();
const receipt = {
  loop: "chatgpt-read-current",
  target: targetUrl,
  session: session || null,
  project,
  startedAt: new Date().toISOString(),
  responseTimeoutMs,
};

try {
  operationHandle = await acquireChatGptOperation({
    name: "read",
    kind: "live-browser",
    runId,
    alias: session,
    project,
    requiresBrowser: true,
    lockTimeoutMs,
    noWait: noWaitForLock,
    staleLockTtlMs,
  });
  Object.assign(receipt, operationHandle.receipt());
  receipt.owner = receipt.locks.browser.owner;
  receipt.lock = receipt.locks.browser.receipt;

  if (session) {
    const connected = await connectToChatGptSession(port, session);
    cdp = connected.cdp;
    receipt.sessionTarget = {
      targetId: connected.target.id,
      title: connected.target.title,
      url: connected.target.url,
    };
    receipt.roomTarget = connected.roomTarget || null;
  } else {
    cdp = await connectToPage(port, { matchUrl: targetUrl });
  }
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  const before = await pageProbe(cdp);
  writeJson(resolve(runDir, "initial-probe.json"), redactedProbe(before));

  const response = await waitForAssistantResponse(cdp, Math.max(0, before.assistantTurns.length - 1), {
    timeoutMs: responseTimeoutMs,
    stableMs,
  });
  assistantText = response.assistantText;
  writeFileSync(resolve(runDir, "assistant.md"), assistantText, { mode: 0o600 });

  Object.assign(receipt, {
    ok: true,
    completedAt: new Date().toISOString(),
    conversationUrl: response.probe?.url || before.url,
    title: before.title,
    assistantTextLength: response.assistantText.length,
    response: {
      textSha256: sha256(response.assistantText),
      charCount: response.assistantText.length,
      finishDetectedBy: response.finishDetectedBy,
    },
    stableMs: response.stableMs,
    totalMs: Math.round(now() - started),
    artifacts: {
      assistant: resolve(runDir, "assistant.md"),
      initialProbe: resolve(runDir, "initial-probe.json"),
    },
  });
} catch (error) {
  Object.assign(receipt, {
    ok: false,
    completedAt: new Date().toISOString(),
    errorCode: error?.errorCode || "response.read_failed",
    error: String(error?.message || error),
    failure: error?.details || undefined,
    totalMs: Math.round(now() - started),
  });
  if (error?.details?.owner && !receipt.owner) receipt.owner = error.details.owner;
  if (error?.details?.lock && !receipt.lock) receipt.lock = error.details.lock;
  if (error?.details?.operation && !receipt.operation) receipt.operation = error.details.operation;
  if (error?.details?.locks && !receipt.locks) receipt.locks = error.details.locks;
} finally {
  const actionSummaryPath = resolve(runDir, "action-summary.md");
  const actionSummary = renderActionSummary({
    assistantText,
    receipt: {
      ...receipt,
      artifacts: {
        ...(receipt.artifacts || {}),
        assistant: resolve(runDir, "assistant.md"),
        transcript: resolve(runDir, "transcript.md"),
        receipt: resolve(runDir, "receipt.json"),
      },
    },
  });
  writeFileSync(actionSummaryPath, actionSummary, { mode: 0o600 });
  receipt.actionSummary = {
    path: actionSummaryPath,
    sha256: sha256(actionSummary),
    charCount: actionSummary.length,
  };
  receipt.artifacts = {
    ...(receipt.artifacts || {}),
    actionSummary: actionSummaryPath,
  };
  envelope = sealRunEnvelope({
    kind: "read",
    runDir,
    receipt,
    receivedMarkdown: assistantText,
    stdoutRendered: stdoutThreadEcho,
    stdoutMode: threadOutputMode,
  });
  if (cdp) await cdp.close().catch(() => {});
  if (operationHandle) {
    try {
      Object.assign(receipt, await operationHandle.release());
      receipt.lock = receipt.locks.browser.receipt;
    } catch (error) {
      const fallback = operationHandle.receipt();
      Object.assign(receipt, fallback);
      receipt.lock = {
        ...(fallback.locks.browser.receipt || receipt.lock || {}),
        releaseErrorCode: error?.errorCode || "lock.release_failed",
        releaseError: String(error?.message || error),
      };
      receipt.lockReleaseFailure = error?.details || null;
    } finally {
      operationHandle = null;
    }
  }
  writeJson(resolve(runDir, "receipt.json"), receipt);
}

console.log(JSON.stringify(stdoutActionSummary ? compactReceipt(receipt) : receipt, null, 2));
if (stdoutThreadEcho) {
  console.log("");
  console.log(envelope.transcriptMarkdown.trimEnd());
} else if (stdoutActionSummary) {
  console.log("");
  console.log(renderActionSummary({ assistantText, receipt }).trimEnd());
}
process.exit(receipt.ok ? 0 : 1);
