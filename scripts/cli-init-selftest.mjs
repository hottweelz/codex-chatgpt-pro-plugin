import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-init-test-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-home-test-"));
const realRepo = realpathSync(repo);

function runInitResult(extraArgs = []) {
  return spawnSync(
    process.execPath,
    [resolve("bin", "chatgpt-pro"), "init", ...extraArgs],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        CHATGPT_PRO_HOME: home,
      },
    },
  );
}

function runInit(extraArgs = []) {
  const result = runInitResult(extraArgs);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

try {
  const first = runInit();
  assert.equal(first.ok, true);
  assert.equal(first.command, "init");
  assert.equal(first.project.repoRoot, realRepo);
  assert.equal(existsSync(resolve(repo, ".devspace/state/chatgpt-project.json")), true);
  assert.equal(existsSync(first.sessions.path), true);
  assert.equal(existsSync(resolve(repo, ".codex/skills/chatgpt-pro-line/SKILL.md")), true);

  const project = JSON.parse(readFileSync(resolve(repo, ".devspace/state/chatgpt-project.json"), "utf8"));
  assert.equal(project.repoRoot, realRepo);
  assert.equal(project.schemaVersion, 1);

  const sessions = JSON.parse(readFileSync(first.sessions.path, "utf8"));
  assert.deepEqual(sessions, {
    schemaVersion: 2,
    projectId: project.projectId,
    rooms: {},
    freshThreads: [],
  });

  const second = runInit();
  assert.equal(second.ok, true);
  assert.equal(second.project.projectId, first.project.projectId);
  assert.equal(second.sessions.path, first.sessions.path);
  assert.equal(second.sessions.created, false);
  assert.equal(second.skill.changed, false);

  const skillPath = resolve(repo, ".codex/skills/chatgpt-pro-line/SKILL.md");
  const localSkill = "local skill customization\n";
  writeFileSync(skillPath, localSkill);
  const skipped = runInit();
  assert.equal(skipped.skill.skipped, true);
  assert.equal(readFileSync(skillPath, "utf8"), localSkill);

  const forced = runInit(["--force-skill"]);
  assert.equal(forced.skill.changed, true);
  assert.equal(existsSync(forced.skill.backupPath), true);
  assert.equal(readFileSync(forced.skill.backupPath, "utf8"), localSkill);
  assert.notEqual(readFileSync(skillPath, "utf8"), localSkill);

  const firstBackupPath = forced.skill.backupPath;
  const firstBackupText = readFileSync(firstBackupPath, "utf8");
  const forcedAgain = runInit(["--force-skill"]);
  assert.notEqual(forcedAgain.skill.backupPath, firstBackupPath);
  assert.equal(readFileSync(firstBackupPath, "utf8"), firstBackupText);
  assert.equal(existsSync(forcedAgain.skill.backupPath), true);

  rmSync(skillPath);
  const symlinkTarget = resolve(repo, "must-not-change.txt");
  writeFileSync(symlinkTarget, "protected\n");
  symlinkSync(symlinkTarget, skillPath);
  const symlinkInit = runInitResult(["--force-skill"]);
  assert.equal(symlinkInit.status, 1);
  assert.match(symlinkInit.stdout, /Refusing to read or replace symbolic-link skill target/);
  assert.equal(readFileSync(symlinkTarget, "utf8"), "protected\n");
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "cli-init" }, null, 2));
