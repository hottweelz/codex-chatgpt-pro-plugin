import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { repoRoot } from "./runtime-config.mjs";

const DEFAULT_LOCK_TIMEOUT_MS = 600_000;
const DEFAULT_STALE_LOCK_TTL_MS = 900_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
const RECLAIM_MARKER_WAIT_MS = 5_000;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function chatGptProHome() {
  return resolve(process.env.CHATGPT_PRO_HOME || join(homedir(), ".chatgpt-pro-codex"));
}

export function browserProfileLockPaths(root = chatGptProHome()) {
  const lockDir = resolve(root, "locks", "browser-profile.lock");
  return {
    root,
    lockDir,
    ownerPath: resolve(lockDir, "owner.json"),
    heartbeatPath: resolve(lockDir, "heartbeat.json"),
    initializingPath: resolve(lockDir, "initializing.json"),
    reclaimDir: resolve(lockDir, "reclaim.lock"),
    reclaimOwnerPath: resolve(lockDir, "reclaim.lock", "owner.json"),
    reclaimActionDir: resolve(lockDir, "reclaim.lock", "action.lock"),
    reclaimActionOwnerPath: resolve(lockDir, "reclaim.lock", "action.lock", "owner.json"),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeExclusiveJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

function initializeBrowserProfileLock(paths, owner, runId) {
  let createdLockIdentity = null;
  try {
    mkdirSync(paths.lockDir);
    createdLockIdentity = lockIdentity(paths.lockDir);
    const assertCreatedLock = () => {
      if (!sameLockIdentity(lockIdentity(paths.lockDir), createdLockIdentity)) {
        const error = new Error("Browser profile lock changed during initialization.");
        error.errorCode = "lock.initialization_lost";
        throw error;
      }
    };
    assertCreatedLock();
    writeExclusiveJson(paths.initializingPath, {
      runId,
      startedAt: nowIso(),
      purpose: "browser-lock-initialization",
    });
    assertCreatedLock();
    writeExclusiveJson(paths.ownerPath, owner);
    assertCreatedLock();
    writeExclusiveJson(paths.heartbeatPath, { runId, lastHeartbeatAt: nowIso() });
    assertCreatedLock();
    return true;
  } catch (error) {
    if (!createdLockIdentity && error?.code === "EEXIST") return false;
    if (createdLockIdentity && sameLockIdentity(lockIdentity(paths.lockDir), createdLockIdentity)) {
      rmSync(paths.lockDir, { recursive: true, force: true });
    }
    throw error;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function ownerAliveForHost(owner) {
  const recordedHost = String(owner?.hostname || "").trim();
  if (!recordedHost || recordedHost !== hostname()) return null;
  return pidAlive(owner?.pid);
}

function sameOwner(a, b) {
  if (!a || !b) return a === b;
  return ["runId", "pid", "hostname", "startedAt", "nonce"].every((key) =>
    (a[key] ?? null) === (b[key] ?? null),
  );
}

function ageMsFromTimestamp(value, fallbackPath) {
  const parsed = value ? Date.parse(value) : NaN;
  if (Number.isFinite(parsed)) return Date.now() - parsed;
  try {
    return Date.now() - statSync(fallbackPath).mtimeMs;
  } catch {
    return null;
  }
}

function lockIdentity(lockDir) {
  try {
    const stat = statSync(lockDir);
    return {
      dev: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
    };
  } catch {
    return null;
  }
}

function sameLockIdentity(a, b) {
  return Boolean(a && b)
    && a.dev === b.dev
    && a.ino === b.ino
    && a.birthtimeMs === b.birthtimeMs;
}

function markerIsStale(markerOwner, markerPath, staleLockTtlMs) {
  const ageMs = ageMsFromTimestamp(markerOwner?.claimedAt, markerPath);
  return ageMs == null || ageMs > staleLockTtlMs;
}

function cleanupReclaimMarker(paths, claimant, expectedLockIdentity = null) {
  if (!existsSync(paths.reclaimDir)) return;
  if (expectedLockIdentity && !sameLockIdentity(lockIdentity(paths.lockDir), expectedLockIdentity)) return;
  const markerOwner = readJson(paths.reclaimOwnerPath);
  if (sameOwner(markerOwner, claimant)) {
    rmSync(paths.reclaimDir, { recursive: true, force: true });
  }
}

function cleanupReclaimAction(paths, claimant) {
  if (!existsSync(paths.reclaimActionDir)) return;
  const actionOwner = readJson(paths.reclaimActionOwnerPath);
  if (sameOwner(actionOwner, claimant)) {
    rmSync(paths.reclaimActionDir, { recursive: true, force: true });
  }
}

function reclaimActionQuarantinePath(paths, claimant) {
  return resolve(dirname(paths.reclaimActionDir), `.action-reclaim-${claimant.nonce}`);
}

function tryClaimReclaimAction(paths, claimant, staleLockTtlMs) {
  try {
    mkdirSync(paths.reclaimActionDir);
    writeJson(paths.reclaimActionOwnerPath, {
      ...claimant,
      claimedAt: nowIso(),
      purpose: "stale-lock-reclaim-action",
    });
    return true;
  } catch (error) {
    if (["ENOENT", "EINVAL"].includes(error?.code)) return false;
    if (error?.code !== "EEXIST") throw error;
  }

  const actionOwner = readJson(paths.reclaimActionOwnerPath);
  if (sameOwner(actionOwner, claimant)) return true;
  const actionAlive = ownerAliveForHost(actionOwner);
  if (actionAlive === true || (actionAlive === null && !markerIsStale(actionOwner, paths.reclaimActionDir, staleLockTtlMs))) {
    return false;
  }

  const observedActionIdentity = lockIdentity(paths.reclaimActionDir);
  const observedActionOwner = readJson(paths.reclaimActionOwnerPath);
  if (!observedActionIdentity || !sameOwner(observedActionOwner, actionOwner)) return false;
  const quarantinePath = reclaimActionQuarantinePath(paths, claimant);
  try {
    renameSync(paths.reclaimActionDir, quarantinePath);
  } catch (error) {
    if (["ENOENT", "EEXIST", "EINVAL"].includes(error?.code)) return false;
    throw error;
  }
  try {
    const movedIdentity = lockIdentity(quarantinePath);
    const movedOwner = readJson(resolve(quarantinePath, "owner.json"));
    if (!sameLockIdentity(movedIdentity, observedActionIdentity)
      || !sameOwner(movedOwner, observedActionOwner)) {
      try {
        renameSync(quarantinePath, paths.reclaimActionDir);
      } catch {
        // A replacement action marker already exists. Leave it untouched.
      }
      return false;
    }
    mkdirSync(paths.reclaimActionDir);
    writeJson(paths.reclaimActionOwnerPath, {
      ...claimant,
      claimedAt: nowIso(),
      purpose: "stale-lock-reclaim-action-recovered",
    });
    return true;
  } catch (error) {
    if (["ENOENT", "EINVAL", "EEXIST"].includes(error?.code)) return false;
    throw error;
  } finally {
    rmSync(quarantinePath, { recursive: true, force: true });
  }
}

function tryClaimReclaimMarker(paths, claimant, staleLockTtlMs, expectedLockIdentity = null) {
  if (expectedLockIdentity && !sameLockIdentity(lockIdentity(paths.lockDir), expectedLockIdentity)) {
    return false;
  }
  try {
    mkdirSync(paths.reclaimDir);
    writeJson(paths.reclaimOwnerPath, {
      ...claimant,
      claimedAt: nowIso(),
      purpose: "stale-lock-reclaim",
    });
    return true;
  } catch (error) {
    if (["ENOENT", "EINVAL"].includes(error?.code)) return false;
    if (error?.code !== "EEXIST") throw error;
  }

  if (!tryClaimReclaimAction(paths, claimant, staleLockTtlMs)) return false;
  const markerOwner = readJson(paths.reclaimOwnerPath);
  if (sameOwner(markerOwner, claimant)) return true;
  const markerAlive = ownerAliveForHost(markerOwner);
  if (markerAlive === true || (markerAlive === null && !markerIsStale(markerOwner, paths.reclaimDir, staleLockTtlMs))) {
    cleanupReclaimAction(paths, claimant);
    return false;
  }

  if (expectedLockIdentity && !sameLockIdentity(lockIdentity(paths.lockDir), expectedLockIdentity)) {
    cleanupReclaimAction(paths, claimant);
    return false;
  }

  const markerIdentity = lockIdentity(paths.reclaimDir);
  if (!markerIdentity || !sameLockIdentity(lockIdentity(paths.reclaimDir), markerIdentity)) {
    cleanupReclaimAction(paths, claimant);
    return false;
  }
  rmSync(paths.reclaimDir, { recursive: true, force: true });
  try {
    mkdirSync(paths.reclaimDir);
    writeJson(paths.reclaimOwnerPath, {
      ...claimant,
      claimedAt: nowIso(),
      purpose: "stale-lock-reclaim-recovered",
    });
    return true;
  } catch (error) {
    if (["ENOENT", "EINVAL", "EEXIST"].includes(error?.code)) return false;
    throw error;
  }
}

async function claimReclaimMarker(paths, claimant, staleLockTtlMs, expectedLockIdentity = null, timeoutMs = RECLAIM_MARKER_WAIT_MS) {
  const startedAt = Date.now();
  while (true) {
    if (tryClaimReclaimMarker(paths, claimant, staleLockTtlMs, expectedLockIdentity)) return true;
    if (Date.now() - startedAt >= timeoutMs) return false;
    await sleep(25);
  }
}

export function readBrowserProfileLockStatus({
  root = chatGptProHome(),
  staleLockTtlMs = DEFAULT_STALE_LOCK_TTL_MS,
} = {}) {
  const paths = browserProfileLockPaths(root);
  if (!existsSync(paths.lockDir)) {
    return {
      scope: "browser-profile",
      path: paths.lockDir,
      busy: false,
      owner: null,
      heartbeat: null,
      lockIdentity: null,
      ownerAlive: null,
      stale: false,
      ageMs: null,
    };
  }

  const owner = readJson(paths.ownerPath);
  const heartbeat = readJson(paths.heartbeatPath);
  const initializing = readJson(paths.initializingPath);
  const lastHeartbeatMs = heartbeat?.lastHeartbeatAt ? Date.parse(heartbeat.lastHeartbeatAt) : NaN;
  const ageMs = Number.isFinite(lastHeartbeatMs)
    ? Date.now() - lastHeartbeatMs
    : ageMsFromTimestamp(owner?.startedAt || initializing?.startedAt, paths.lockDir);
  const ownerAlive = ownerAliveForHost(owner);
  return {
    scope: "browser-profile",
    path: paths.lockDir,
    busy: true,
    owner,
    heartbeat,
    lockIdentity: lockIdentity(paths.lockDir),
    ownerAlive,
    stale: ageMs == null || ageMs > staleLockTtlMs,
    ageMs,
  };
}

function lockError(errorCode, message, details) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function createOwner({ runId, alias, project }) {
  return {
    runId,
    nonce: randomUUID(),
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    cwd: process.cwd(),
    repoRoot: project?.repoRoot || repoRoot,
    projectId: project?.projectId || null,
    alias: alias || null,
    startedAt: nowIso(),
  };
}

function publicLockStatus(status, extra = {}) {
  return {
    scope: "browser-profile",
    path: status.path,
    busy: status.busy,
    owner: status.owner || null,
    ownerAlive: status.ownerAlive,
    stale: status.stale,
    ageMs: status.ageMs,
    ...extra,
  };
}

export async function acquireBrowserProfileLock({
  runId,
  alias = "",
  project = null,
  root = chatGptProHome(),
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  noWait = false,
  staleLockTtlMs = DEFAULT_STALE_LOCK_TTL_MS,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
} = {}) {
  if (!runId) throw new Error("runId is required to acquire the browser profile lock.");

  const paths = browserProfileLockPaths(root);
  const startedAtMs = Date.now();
  const owner = createOwner({ runId, alias, project });
  let staleLockReclaimed = false;
  let staleLockDetected = false;

  mkdirSync(dirname(paths.lockDir), { recursive: true });

  while (true) {
    try {
      if (!initializeBrowserProfileLock(paths, owner, runId)) {
        const busy = new Error("Browser profile lock is already held.");
        busy.code = "EEXIST";
        throw busy;
      }
      const acquiredAtMs = Date.now();
      const interval = setInterval(() => {
        try {
          const currentOwner = readJson(paths.ownerPath);
          if (sameOwner(currentOwner, owner)) {
            writeJson(paths.heartbeatPath, { runId, lastHeartbeatAt: nowIso() });
          }
        } catch {
          // Best-effort heartbeat; acquire/release paths report authoritative errors.
        }
      }, heartbeatIntervalMs);
      interval.unref?.();

      let released = false;
      const baseReceipt = {
        scope: "browser-profile",
        path: paths.lockDir,
        waitMs: acquiredAtMs - startedAtMs,
        acquiredAt: new Date(acquiredAtMs).toISOString(),
        staleLockDetected,
        staleLockReclaimed,
      };

      return {
        owner,
        receipt() {
          return {
            ...baseReceipt,
            heldMs: Date.now() - acquiredAtMs,
            released,
          };
        },
        async release() {
          const currentOwner = readJson(paths.ownerPath);
          if (!sameOwner(currentOwner, owner)) {
            const error = lockError(
              "lock.release_failed",
              "Browser profile lock owner changed before release.",
              {
                lock: {
                  ...baseReceipt,
                  heldMs: Date.now() - acquiredAtMs,
                  released: false,
                  currentOwner,
                },
                owner,
              },
            );
            throw error;
          }
          const expectedLockIdentity = lockIdentity(paths.lockDir);
          const claimed = await claimReclaimMarker(paths, owner, staleLockTtlMs, expectedLockIdentity);
          if (!claimed) {
            throw lockError(
              "lock.release_failed",
              "Browser profile lock could not claim the removal marker before release.",
              { owner, lock: baseReceipt },
            );
          }
          try {
            const latestOwner = readJson(paths.ownerPath);
            if (!sameOwner(latestOwner, owner) || !sameLockIdentity(lockIdentity(paths.lockDir), expectedLockIdentity)) {
              throw lockError(
                "lock.release_failed",
                "Browser profile lock owner changed before release.",
                {
                  lock: {
                    ...baseReceipt,
                    heldMs: Date.now() - acquiredAtMs,
                    released: false,
                    currentOwner: latestOwner,
                  },
                  owner,
                },
              );
            }
            rmSync(paths.lockDir, { recursive: true, force: true });
            clearInterval(interval);
          } finally {
            cleanupReclaimMarker(paths, owner, expectedLockIdentity);
            cleanupReclaimAction(paths, owner);
          }
          released = true;
          return {
            ...baseReceipt,
            heldMs: Date.now() - acquiredAtMs,
            released: true,
            releasedAt: nowIso(),
          };
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const status = readBrowserProfileLockStatus({ root, staleLockTtlMs });
      const ownerConfirmedDead = status.ownerAlive === false;
      const unknownOwnerIsStale = status.ownerAlive === null && status.stale;
      if (ownerConfirmedDead || unknownOwnerIsStale) {
        staleLockDetected = true;
        const claimant = owner;
        const claimed = tryClaimReclaimMarker(paths, claimant, staleLockTtlMs, status.lockIdentity);
        if (claimed) {
          try {
            const latest = readBrowserProfileLockStatus({ root, staleLockTtlMs });
            const latestDead = latest.ownerAlive === false || (latest.ownerAlive === null && latest.stale);
            if (sameOwner(latest.owner, status.owner)
              && sameLockIdentity(latest.lockIdentity, status.lockIdentity)
              && latestDead) {
              rmSync(paths.lockDir, { recursive: true, force: true });
              staleLockReclaimed = true;
              continue;
            }
          } finally {
            cleanupReclaimMarker(paths, claimant, status.lockIdentity);
          }
        }
      }
      if (status.stale) {
        staleLockDetected = true;
      }

      const waitedMs = Date.now() - startedAtMs;
      const lock = publicLockStatus(status, {
        waitMs: waitedMs,
        staleLockDetected,
        staleLockReclaimed,
      });

      if (noWait) {
        throw lockError("lock.busy", "Browser profile lock is already held.", { lock, owner: status.owner || null });
      }
      if (waitedMs >= timeoutMs) {
        throw lockError("lock.timeout", "Timed out waiting for the browser profile lock.", { lock, owner: status.owner || null });
      }

      await sleep(250);
    }
  }
}
