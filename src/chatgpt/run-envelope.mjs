import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  RECEIVED_HEADING,
  SENT_HEADING,
  renderChatGptTranscript,
  renderReceivedEcho,
  shouldPrintThreadEcho,
  threadEchoOutputMode,
} from "../transcript.mjs";

export function sha256Text(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function fileSha256(path) {
  return sha256Text(readFileSync(path, "utf8"));
}

function artifactPath(runDir, file) {
  return resolve(runDir, file);
}

export function renderEnvelopeTranscript({ kind = "call", sentMarkdown = "", receivedMarkdown = "" } = {}) {
  if (kind === "read") return renderReceivedEcho({ receivedMarkdown });
  return renderChatGptTranscript({ sentMarkdown, receivedMarkdown });
}

export function threadEchoMode(env = process.env) {
  const mode = threadEchoOutputMode(env);
  return mode === "disabled" ? "disabled_by_env" : mode;
}

export function sealRunEnvelope({
  kind = "call",
  runDir,
  receipt,
  sentMarkdown = "",
  receivedMarkdown = "",
  stdoutRendered = shouldPrintThreadEcho(),
  stdoutMode = null,
} = {}) {
  if (!runDir) throw new Error("runDir is required to seal a ChatGPT run envelope.");
  if (!receipt) throw new Error("receipt is required to seal a ChatGPT run envelope.");

  const transcriptMarkdown = renderEnvelopeTranscript({ kind, sentMarkdown, receivedMarkdown });
  const transcriptPath = artifactPath(runDir, "transcript.md");
  writeFileSync(transcriptPath, transcriptMarkdown, { mode: 0o600 });

  const promptPath = artifactPath(runDir, "prompt.md");
  const inputPath = artifactPath(runDir, "input.md");
  const assistantPath = artifactPath(runDir, "assistant.md");
  const receiptPath = artifactPath(runDir, "receipt.json");

  const artifacts = {
    ...(receipt.artifacts || {}),
    receipt: receiptPath,
    transcript: transcriptPath,
  };
  if (existsSync(inputPath)) artifacts.input = inputPath;
  if (existsSync(promptPath)) artifacts.prompt = promptPath;
  if (existsSync(assistantPath)) artifacts.assistant = assistantPath;

  const artifactHashes = {
    ...(receipt.artifactHashes || {}),
    transcriptSha256: sha256Text(transcriptMarkdown),
  };
  if (existsSync(inputPath)) artifactHashes.inputSha256 = fileSha256(inputPath);
  if (existsSync(promptPath)) artifactHashes.promptSha256 = fileSha256(promptPath);
  if (existsSync(assistantPath)) artifactHashes.assistantSha256 = fileSha256(assistantPath);

  const configuredMode = threadEchoMode();
  const mode = stdoutMode || (stdoutRendered
    ? "enabled"
    : configuredMode === "summary"
      ? "summary"
      : "disabled_by_env");
  const threadEcho = {
    mode,
    stdoutRendered: Boolean(stdoutRendered),
    requiredForInteractive: true,
    contract: mode === "summary" ? "agent_must_read_full_artifact_and_act" : "agent_must_paste_verbatim",
    enforcement: mode === "enabled"
      ? "stdout_rendered_not_verified"
      : mode === "summary"
        ? "summary_rendered_not_verified"
        : "disabled_by_env",
    transcriptSha256: artifactHashes.transcriptSha256,
    sentSha256: sha256Text(sentMarkdown),
    receivedSha256: sha256Text(receivedMarkdown),
  };

  Object.assign(receipt, {
    kind,
    threadEcho,
    artifactHashes,
    artifacts,
  });

  return {
    kind,
    transcriptMarkdown,
    transcriptPath,
    artifacts,
    artifactHashes,
    threadEcho,
  };
}

export function verifyRunEnvelope({ receiptPath } = {}) {
  if (!receiptPath) throw new Error("Provide --receipt=<path>.");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const runDir = receipt.runDir || dirname(resolve(receiptPath));
  const kind = receipt.kind || receipt.loop?.replace(/^chatgpt-/, "") || "call";
  const artifacts = receipt.artifacts || {};
  const promptPath = artifacts.prompt || artifactPath(runDir, "prompt.md");
  const assistantPath = artifacts.assistant || artifactPath(runDir, "assistant.md");
  const transcriptPath = artifacts.transcript || artifactPath(runDir, "transcript.md");

  if (!existsSync(transcriptPath)) {
    const error = new Error(`Missing transcript artifact: ${transcriptPath}`);
    error.errorCode = "transcript.missing";
    throw error;
  }
  const transcriptMarkdown = readFileSync(transcriptPath, "utf8");
  if (!transcriptMarkdown.includes(`## ${RECEIVED_HEADING}`)) {
    const error = new Error(`Transcript missing heading: ## ${RECEIVED_HEADING}`);
    error.errorCode = "transcript.heading_missing";
    throw error;
  }
  if (kind !== "read" && !transcriptMarkdown.includes(`## ${SENT_HEADING}`)) {
    const error = new Error(`Transcript missing heading: ## ${SENT_HEADING}`);
    error.errorCode = "transcript.heading_missing";
    throw error;
  }

  const sentMarkdown = existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
  const receivedMarkdown = existsSync(assistantPath) ? readFileSync(assistantPath, "utf8") : "";
  const expected = renderEnvelopeTranscript({
    kind: kind === "read" ? "read" : "call",
    sentMarkdown,
    receivedMarkdown,
  });
  if (transcriptMarkdown !== expected) {
    const error = new Error("Transcript content does not match the canonical renderer.");
    error.errorCode = "transcript.renderer_mismatch";
    throw error;
  }

  const actual = {
    transcriptSha256: sha256Text(transcriptMarkdown),
    sentSha256: sha256Text(sentMarkdown),
    receivedSha256: sha256Text(receivedMarkdown),
  };
  const actionSummary = receipt.actionSummary || null;
  if (actionSummary?.path) {
    if (!existsSync(actionSummary.path)) {
      const error = new Error(`Missing action summary artifact: ${actionSummary.path}`);
      error.errorCode = "transcript.action_summary_missing";
      throw error;
    }
    const actualSummarySha256 = sha256Text(readFileSync(actionSummary.path, "utf8"));
    if (actionSummary.sha256 && actionSummary.sha256 !== actualSummarySha256) {
      const error = new Error("Receipt action summary hash does not match the artifact.");
      error.errorCode = "transcript.action_summary_hash_mismatch";
      error.details = {
        expected: actionSummary.sha256,
        actual: actualSummarySha256,
      };
      throw error;
    }
  }
  const threadEcho = receipt.threadEcho || {};
  for (const [key, value] of Object.entries(actual)) {
    if (threadEcho[key] && threadEcho[key] !== value) {
      const error = new Error(`Receipt threadEcho.${key} does not match artifacts.`);
      error.errorCode = "transcript.hash_mismatch";
      error.details = { key, expected: threadEcho[key], actual: value };
      throw error;
    }
  }

  return {
    ok: true,
    receiptPath,
    transcriptPath,
    kind,
    threadEcho: {
      ...threadEcho,
      ...actual,
    },
  };
}
