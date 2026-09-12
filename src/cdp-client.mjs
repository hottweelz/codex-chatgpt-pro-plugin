export const now = () => performance.now();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`CDP /json -> ${response.status}`);
  const targets = await response.json();
  if (!Array.isArray(targets)) {
    const error = new Error("CDP /json returned an invalid target list.");
    error.errorCode = "browser.invalid_target_list";
    error.details = { targetType: typeof targets };
    throw error;
  }
  return targets;
}

function matchesTargetUrl(pageUrl, matchUrl) {
  if (!matchUrl) return true;
  try {
    const expected = new URL(matchUrl);
    const actual = new URL(pageUrl);
    if (expected.protocol !== actual.protocol
      || expected.hostname !== actual.hostname
      || expected.port !== actual.port) {
      return false;
    }
    if (expected.username || expected.password || actual.username || actual.password) return false;
    const expectedPath = expected.pathname.replace(/\/+$/, "") || "/";
    const actualPath = actual.pathname.replace(/\/+$/, "") || "/";
    return expectedPath === "/"
      || actualPath === expectedPath
      || actualPath.startsWith(`${expectedPath}/`);
  } catch {
    return false;
  }
}

function redactTargetUrl(pageUrl) {
  const value = String(pageUrl || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export async function connectToPage(port, { matchUrl, retries = 30, delayMs = 100 } = {}) {
  let lastError = null;
  let lastEnumerationSucceeded = false;
  let matchingTargetSeen = false;
  let availablePageUrls = [];

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const targets = await listTargets(port);
      lastEnumerationSucceeded = true;
      const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
      availablePageUrls = pages
        .map((page) => redactTargetUrl(page.url))
        .filter(Boolean);
      const target = matchUrl
        ? pages.find((page) => matchesTargetUrl(page.url, matchUrl))
        : pages[0];
      if (target) {
        matchingTargetSeen = Boolean(matchUrl) || matchingTargetSeen;
        try {
          return await CdpSession.open(target.webSocketDebuggerUrl);
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastEnumerationSucceeded = false;
      lastError = error;
      // Chrome may still be starting; retry below.
    }
    if (attempt + 1 < retries) await sleep(delayMs);
  }

  if (matchUrl && lastEnumerationSucceeded && !matchingTargetSeen) {
    const safeMatchUrl = redactTargetUrl(matchUrl) || "[invalid-url]";
    const error = new Error(`No CDP page matched the requested URL: ${safeMatchUrl}`);
    error.errorCode = "browser.target_not_found";
    error.details = {
      matchUrl: safeMatchUrl,
      availablePageUrls: [...new Set(availablePageUrls)].sort(),
    };
    throw error;
  }

  if (lastError) throw lastError;
  throw new Error("No inspectable page target on CDP endpoint.");
}

export async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description || exceptionDetails.text || "evaluate failed",
    );
  }
  return result.value;
}

export async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

export class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => this.#onMessage(event));
  }

  static open(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("open", () => resolve(new CdpSession(ws)));
      ws.addEventListener("error", (event) =>
        reject(new Error(`CDP socket error: ${event?.message || "unknown"}`)),
      );
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => this.listeners.get(method)?.delete(handler);
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }

  #onMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    } catch {
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (code ${message.error.code})`));
      else resolve(message.result);
      return;
    }

    if (!message.method) return;
    const handlers = this.listeners.get(message.method);
    if (handlers) for (const handler of [...handlers]) handler(message.params);
  }
}
