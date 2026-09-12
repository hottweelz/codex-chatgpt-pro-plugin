import assert from "node:assert/strict";
import { connectToPage } from "../src/cdp-client.mjs";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
let targets = [];
let fetchPlan = [];
let socketCount = 0;
let openedUrls = [];
let socketFailureMessage = "";

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    socketCount += 1;
    openedUrls.push(url);
    queueMicrotask(() => {
      if (socketFailureMessage) {
        this.listeners.get("error")?.forEach((handler) => handler({ message: socketFailureMessage }));
      } else {
        this.listeners.get("open")?.forEach((handler) => handler({}));
      }
    });
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  send() {}

  close() {}
}

globalThis.fetch = async () => {
  const next = fetchPlan.length ? fetchPlan.shift() : targets;
  if (next instanceof Error) throw next;
  return {
    ok: true,
    async json() {
      return next;
    },
  };
};
globalThis.WebSocket = FakeWebSocket;

try {
  targets = [
    { type: "page", url: "https://z.example/", webSocketDebuggerUrl: "ws://z" },
    { type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://blank" },
    { type: "page", url: "https://z.example/", webSocketDebuggerUrl: "ws://z-duplicate" },
    { type: "page", url: "https://no-socket.example/" },
    { type: "page", url: "https://chatgpt.com.evil/", webSocketDebuggerUrl: "ws://evil" },
    { type: "background_page", url: "https://ignored.example/", webSocketDebuggerUrl: "ws://ignored" },
  ];
  fetchPlan = [targets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.target_not_found");
      assert.deepEqual(error.details, {
        matchUrl: "https://chatgpt.com/",
        availablePageUrls: ["about:blank", "https://chatgpt.com.evil/", "https://z.example/"],
      });
      return true;
    },
  );
  assert.equal(socketCount, 0, "a URL mismatch must not open a WebSocket");

  targets = [
    { type: "page", url: "https://chatgpt.com/c/foo-bar", webSocketDebuggerUrl: "ws://path-collision" },
  ];
  fetchPlan = [targets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/c/foo", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.target_not_found");
      return true;
    },
  );
  assert.equal(socketCount, 0, "a path-prefix collision must not open a WebSocket");

  targets = [
    { type: "page", url: "https://chatgpt.com/c/room-query?actual=1#fragment", webSocketDebuggerUrl: "ws://query" },
  ];
  fetchPlan = [targets];
  const queryMatch = await connectToPage(9222, {
    matchUrl: "https://chatgpt.com/c/room-query?requested=2#other",
    retries: 1,
    delayMs: 0,
  });
  assert.equal(queryMatch.ws.url, "ws://query", "query and fragment do not change page identity");
  await queryMatch.close();

  targets = [
    { type: "page", url: "https://chatgpt.com/c/room-credentials", webSocketDebuggerUrl: "ws://credentials" },
  ];
  fetchPlan = [targets];
  const socketCountBeforeCredentials = socketCount;
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://user:pass@chatgpt.com/", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.target_not_found");
      assert.equal(error.details.matchUrl, "https://chatgpt.com/");
      assert.doesNotMatch(error.message, /user|pass/);
      return true;
    },
  );
  assert.equal(socketCount, socketCountBeforeCredentials, "credential-bearing match URLs must not connect");

  targets = [
    {
      type: "page",
      url: "https://user:pass@chatgpt.com/c/private?token=secret#fragment",
      webSocketDebuggerUrl: "ws://credential-target",
    },
  ];
  fetchPlan = [targets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.target_not_found");
      assert.deepEqual(error.details.availablePageUrls, ["https://chatgpt.com/c/private"]);
      return true;
    },
    "target diagnostics must not expose URL credentials or query data",
  );

  fetchPlan = [new Error("CDP fetch failed")];
  const socketCountBeforeFetchFailure = socketCount;
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, undefined);
      assert.match(error.message, /CDP fetch failed/);
      return true;
    },
  );
  assert.equal(socketCount, socketCountBeforeFetchFailure, "a fetch failure must not open a WebSocket");

  fetchPlan = [[]];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.target_not_found");
      assert.deepEqual(error.details.availablePageUrls, []);
      return true;
    },
  );

  fetchPlan = [{ malformed: true }];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 1, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.invalid_target_list");
      assert.deepEqual(error.details, { targetType: "object" });
      return true;
    },
  );

  const matchingTargets = [
    { type: "page", url: "https://chatgpt.com/c/room-fail", webSocketDebuggerUrl: "ws://chatgpt-fail" },
  ];
  socketFailureMessage = "socket failed";
  fetchPlan = [matchingTargets, matchingTargets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 2, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, undefined);
      assert.match(error.message, /socket failed/);
      return true;
    },
  );
  socketFailureMessage = "";

  const mismatchTargets = [
    { type: "page", url: "https://other.example/", webSocketDebuggerUrl: "ws://other" },
  ];

  fetchPlan = [new Error("initial CDP fetch failed"), mismatchTargets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 2, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, "browser.target_not_found");
      assert.deepEqual(error.details.availablePageUrls, ["https://other.example/"]);
      return true;
    },
  );

  socketFailureMessage = "socket failed";
  fetchPlan = [matchingTargets, new Error("final fetch after socket failure")];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 2, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, undefined);
      assert.match(error.message, /final fetch after socket failure/);
      return true;
    },
  );
  socketFailureMessage = "";

  socketFailureMessage = "final socket failed";
  fetchPlan = [mismatchTargets, matchingTargets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 2, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, undefined);
      assert.match(error.message, /final socket failed/);
      return true;
    },
  );
  socketFailureMessage = "";

  socketFailureMessage = "socket failed";
  fetchPlan = [matchingTargets, mismatchTargets];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 2, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, undefined);
      assert.match(error.message, /socket failed/);
      return true;
    },
  );
  socketFailureMessage = "";

  fetchPlan = [mismatchTargets, new Error("final CDP fetch failed")];
  await assert.rejects(
    () => connectToPage(9222, { matchUrl: "https://chatgpt.com/", retries: 2, delayMs: 0 }),
    (error) => {
      assert.equal(error.errorCode, undefined);
      assert.match(error.message, /final CDP fetch failed/);
      return true;
    },
  );

  targets = [
    { type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://blank" },
    { type: "page", url: "https://chatgpt.com/c/room-1", webSocketDebuggerUrl: "ws://chatgpt" },
  ];
  fetchPlan = [targets];
  const matched = await connectToPage(9222, {
    matchUrl: "https://chatgpt.com/",
    retries: 1,
    delayMs: 0,
  });
  assert.equal(matched.ws.url, "ws://chatgpt");
  await matched.close();

  targets = [
    { type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://blank" },
    { type: "page", url: "https://chatgpt.com/c/room-2", webSocketDebuggerUrl: "ws://chatgpt-2" },
  ];
  fetchPlan = [targets];
  const firstPage = await connectToPage(9222, { retries: 1, delayMs: 0 });
  assert.equal(firstPage.ws.url, "ws://blank", "no matchUrl keeps first-page behavior");
  await firstPage.close();
  assert.equal(openedUrls.includes("ws://chatgpt"), true);
  assert.equal(openedUrls.includes("ws://blank"), true);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
}

console.log(JSON.stringify({ ok: true, tested: "cdp-client" }, null, 2));
