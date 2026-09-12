import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  acquireBrowserProfileLock,
  browserProfileLockPaths,
  readBrowserProfileLockStatus,
} from "../src/browser-lock.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function verifiedUnusedPid() {
  for (let pid = 10_000_000; pid < 10_001_000; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return pid;
    }
  }
  throw new Error("Could not find a verified unused PID for the lock self-test.");
}

function runChild(script, runId, cwd = resolve(".")) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, runId], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectChild);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        rejectChild(new Error(`child ${runId} exited ${code ?? signal}: ${stderr || stdout}`));
        return;
      }
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        resolveChild(JSON.parse(line));
      } catch (error) {
        rejectChild(new Error(`child ${runId} returned invalid JSON: ${error.message}; ${stdout}`));
      }
    });
  });
}

const root = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lock-test-"));

try {
  const first = await acquireBrowserProfileLock({
    root,
    runId: "run-1",
    alias: "main",
    timeoutMs: 1_000,
    noWait: true,
  });
  assert.equal(first.owner.runId, "run-1");

  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-2",
      alias: "main",
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.busy, true);
      assert.equal(error.details.owner.runId, "run-1");
      return true;
    },
  );

  const waited = acquireBrowserProfileLock({
    root,
    runId: "run-3",
    alias: "debug",
    timeoutMs: 2_000,
  });
  setTimeout(() => {
    first.release().catch(() => {});
  }, 100);
  const third = await waited;
  assert.equal(third.owner.runId, "run-3");
  assert.equal(third.receipt().waitMs >= 50, true);
  await third.release();

  const paths = browserProfileLockPaths(root);
  const deadPid = verifiedUnusedPid();

  const replacementRoot = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lock-replacement-test-"));
  try {
    const replacementHandle = await acquireBrowserProfileLock({
      root: replacementRoot,
      runId: "same-run-id",
      noWait: true,
    });
    const replacementPaths = browserProfileLockPaths(replacementRoot);
    writeJson(replacementPaths.ownerPath, {
      ...replacementHandle.owner,
      nonce: "replacement-owner-nonce",
    });
    await assert.rejects(
      () => replacementHandle.release(),
      (error) => {
        assert.equal(error.errorCode, "lock.release_failed");
        return true;
      },
      "a replacement owner with the same runId must not be released by an old handle",
    );
  } finally {
    rmSync(replacementRoot, { recursive: true, force: true });
  }

  const childLockScript = `
    import { acquireBrowserProfileLock } from ${JSON.stringify(resolve("src/browser-lock.mjs"))};
    const handle = await acquireBrowserProfileLock({
      root: ${JSON.stringify(root)},
      runId: process.argv[1],
      alias: "race",
      timeoutMs: 5_000,
      staleLockTtlMs: 60_000,
    });
    const acquired = handle.receipt();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const released = await handle.release();
    console.log(JSON.stringify({
      runId: process.argv[1],
      staleLockReclaimed: acquired.staleLockReclaimed,
      released: released.released,
    }));
  `;
  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "concurrent-dead-owner",
    pid: deadPid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  });
  writeJson(paths.heartbeatPath, {
    runId: "concurrent-dead-owner",
    lastHeartbeatAt: new Date().toISOString(),
  });
  const racers = await Promise.all([
    runChild(childLockScript, "race-a"),
    runChild(childLockScript, "race-b"),
  ]);
  assert.equal(racers.length, 2);
  assert.equal(racers.every((result) => result.released), true);
  assert.equal(racers.filter((result) => result.staleLockReclaimed).length, 1);
  assert.equal(existsSync(paths.lockDir), false);

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "fresh-dead-owner",
    pid: deadPid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  });
  writeJson(paths.heartbeatPath, {
    runId: "fresh-dead-owner",
    lastHeartbeatAt: new Date().toISOString(),
  });
  const freshDeadStatus = readBrowserProfileLockStatus({ root, staleLockTtlMs: 60_000 });
  assert.equal(freshDeadStatus.ownerAlive, false);
  assert.equal(freshDeadStatus.stale, false);
  const freshDeadReclaimed = await acquireBrowserProfileLock({
    root,
    runId: "run-fresh-dead-reclaim",
    staleLockTtlMs: 60_000,
    noWait: true,
  });
  assert.equal(freshDeadReclaimed.receipt().staleLockDetected, true);
  assert.equal(freshDeadReclaimed.receipt().staleLockReclaimed, true);
  await freshDeadReclaimed.release();

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "fresh-unknown-owner",
    pid: deadPid,
    startedAt: new Date().toISOString(),
  });
  writeJson(paths.heartbeatPath, {
    runId: "fresh-unknown-owner",
    lastHeartbeatAt: new Date().toISOString(),
  });
  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-fresh-unknown",
      staleLockTtlMs: 60_000,
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.ownerAlive, null);
      assert.equal(error.details.lock.stale, false);
      return true;
    },
  );
  rmSync(paths.lockDir, { recursive: true, force: true });

  mkdirSync(paths.lockDir, { recursive: true });
  const initializingStatus = readBrowserProfileLockStatus({ root, staleLockTtlMs: 60_000 });
  assert.equal(initializingStatus.owner, null);
  assert.equal(initializingStatus.heartbeat, null);
  assert.equal(initializingStatus.ownerAlive, null);
  assert.equal(initializingStatus.stale, false);
  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-initializing-lock",
      staleLockTtlMs: 60_000,
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.stale, false);
      assert.equal(error.details.lock.ownerAlive, null);
      return true;
    },
  );
  rmSync(paths.lockDir, { recursive: true, force: true });

  mkdirSync(paths.lockDir, { recursive: true });
  const old = new Date("2020-01-01T00:00:00.000Z");
  writeJson(paths.initializingPath, {
    runId: "stale-initializing-owner",
    startedAt: old.toISOString(),
  });
  utimesSync(paths.lockDir, old, old);
  const staleInitializingReclaimed = await acquireBrowserProfileLock({
    root,
    runId: "run-stale-initializing-reclaim",
    staleLockTtlMs: 1,
    noWait: true,
  });
  assert.equal(staleInitializingReclaimed.receipt().staleLockReclaimed, true);
  await staleInitializingReclaimed.release();

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "foreign-host-owner",
    pid: process.pid,
    hostname: "foreign-host.example",
    startedAt: new Date().toISOString(),
  });
  writeJson(paths.heartbeatPath, {
    runId: "foreign-host-owner",
    lastHeartbeatAt: new Date().toISOString(),
  });
  const foreignHostStatus = readBrowserProfileLockStatus({ root, staleLockTtlMs: 60_000 });
  assert.equal(foreignHostStatus.ownerAlive, null);
  assert.equal(foreignHostStatus.stale, false);
  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-foreign-host",
      staleLockTtlMs: 60_000,
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.ownerAlive, null);
      assert.equal(error.details.lock.stale, false);
      return true;
    },
  );
  rmSync(paths.lockDir, { recursive: true, force: true });

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "stale-unknown-owner",
    pid: deadPid,
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "stale-unknown-owner",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  const staleUnknownReclaimed = await acquireBrowserProfileLock({
    root,
    runId: "run-stale-unknown-reclaim",
    staleLockTtlMs: 1,
    noWait: true,
  });
  assert.equal(staleUnknownReclaimed.receipt().staleLockDetected, true);
  assert.equal(staleUnknownReclaimed.receipt().staleLockReclaimed, true);
  await staleUnknownReclaimed.release();

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "stale-owner-with-live-marker",
    pid: deadPid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "stale-owner-with-live-marker",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  mkdirSync(paths.reclaimDir, { recursive: true });
  writeJson(paths.reclaimOwnerPath, {
    runId: "live-reclaim-marker",
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(),
  });
  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-live-marker",
      staleLockTtlMs: 1,
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.ownerAlive, false);
      assert.equal(error.details.lock.stale, true);
      return true;
    },
  );
  assert.equal(existsSync(paths.reclaimDir), true, "a live marker must not be taken over");
  assert.equal(readBrowserProfileLockStatus({ root, staleLockTtlMs: 1 }).owner.runId, "stale-owner-with-live-marker");
  rmSync(paths.lockDir, { recursive: true, force: true });

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "stale-owner-with-dead-marker",
    pid: deadPid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "stale-owner-with-dead-marker",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  mkdirSync(paths.reclaimDir, { recursive: true });
  writeJson(paths.reclaimOwnerPath, {
    runId: "dead-reclaim-marker",
    pid: deadPid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
    claimedAt: "2020-01-01T00:00:00.000Z",
  });
  const takeoverReclaimed = await acquireBrowserProfileLock({
    root,
    runId: "run-marker-takeover",
    staleLockTtlMs: 1,
    noWait: true,
  });
  assert.equal(takeoverReclaimed.receipt().staleLockReclaimed, true);
  await takeoverReclaimed.release();

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "stale-owner-with-dead-action-marker",
    pid: deadPid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "stale-owner-with-dead-action-marker",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  mkdirSync(paths.reclaimDir, { recursive: true });
  writeJson(paths.reclaimOwnerPath, {
    runId: "dead-reclaim-marker-with-dead-action",
    pid: deadPid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
    claimedAt: "2020-01-01T00:00:00.000Z",
  });
  mkdirSync(paths.reclaimActionDir, { recursive: true });
  writeJson(paths.reclaimActionOwnerPath, {
    runId: "dead-reclaim-action-marker",
    pid: deadPid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
    claimedAt: "2020-01-01T00:00:00.000Z",
  });
  const actionTakeoverReclaimed = await acquireBrowserProfileLock({
    root,
    runId: "run-action-marker-takeover",
    staleLockTtlMs: 1,
    noWait: true,
  });
  assert.equal(actionTakeoverReclaimed.receipt().staleLockReclaimed, true);
  await actionTakeoverReclaimed.release();

  const releaseProbe = await acquireBrowserProfileLock({
    root,
    runId: "release-probe",
    staleLockTtlMs: 60_000,
    noWait: true,
  });
  mkdirSync(paths.reclaimDir, { recursive: true });
  writeJson(paths.reclaimOwnerPath, {
    runId: "live-release-marker",
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(),
  });
  const markerRemoval = setTimeout(() => rmSync(paths.reclaimDir, { recursive: true, force: true }), 100);
  const releaseProbeResult = await releaseProbe.release();
  clearTimeout(markerRemoval);
  assert.equal(releaseProbeResult.released, true, "release waits for a live marker instead of deleting around it");
  const replacement = await acquireBrowserProfileLock({
    root,
    runId: "replacement-after-release",
    staleLockTtlMs: 60_000,
    noWait: true,
  });
  assert.equal(replacement.owner.runId, "replacement-after-release");
  await replacement.release();

  const ttlRoot = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lock-ttl-test-"));
  try {
    const ttlHandle = await acquireBrowserProfileLock({
      root: ttlRoot,
      runId: "release-configured-ttl",
      staleLockTtlMs: 10,
      noWait: true,
    });
    const ttlPaths = browserProfileLockPaths(ttlRoot);
    mkdirSync(ttlPaths.reclaimDir, { recursive: true });
    writeJson(ttlPaths.reclaimOwnerPath, {
      runId: "dead-release-marker",
      pid: deadPid,
      hostname: hostname(),
      startedAt: "2020-01-01T00:00:00.000Z",
      claimedAt: new Date(Date.now() - 100).toISOString(),
    });
    const ttlRelease = await ttlHandle.release();
    assert.equal(ttlRelease.released, true, "release must use the caller's stale-lock TTL");
  } finally {
    rmSync(ttlRoot, { recursive: true, force: true });
  }

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "live-owner",
    pid: process.pid,
    hostname: hostname(),
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "live-owner",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-5",
      staleLockTtlMs: 1,
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.stale, true);
      assert.equal(error.details.lock.ownerAlive, true);
      return true;
    },
  );
  assert.equal(existsSync(paths.lockDir), true);
  assert.equal(readBrowserProfileLockStatus({ root, staleLockTtlMs: 1 }).owner.runId, "live-owner");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "browser-lock" }, null, 2));
