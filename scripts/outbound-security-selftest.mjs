import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readOutboundFile } from "../src/repo-context-security.mjs";

const root = mkdtempSync(join(tmpdir(), "chatgpt-outbound-root-"));
const outside = mkdtempSync(join(tmpdir(), "chatgpt-outbound-outside-"));

function expectBlocked(path, errorCode, options = {}) {
  assert.throws(
    () => readOutboundFile(path, options),
    (error) => error?.errorCode === errorCode,
    `${path} did not fail with ${errorCode}`,
  );
}

try {
  const safePath = join(root, "notes.md");
  writeFileSync(safePath, "safe outbound note\n");
  const safe = readOutboundFile(safePath, { root, textOnly: true });
  assert.equal(safe.text, "safe outbound note\n");
  assert.equal(safe.lexicalInside, true);
  assert.equal(safe.realpathInside, true);
  assert.equal(safe.displayPath, "notes.md");

  const envPath = join(root, ".env");
  writeFileSync(envPath, "OPENAI_" + "API_KEY=sk-" + "proj-example-secret-value\n");
  expectBlocked(envPath, "outbound.secret_path_blocked", { root });

  const contentSecretPath = join(root, "config.txt");
  writeFileSync(contentSecretPath, "APP_" + "SEC" + "RET=Rq7xM2nP9vL4sT8wY6zA1bC3dE5fG7hJ9kL2mN4pQ\n");
  expectBlocked(contentSecretPath, "outbound.secret_content_blocked", { root, textOnly: true });

  const symlinkTarget = join(outside, "safe.txt");
  writeFileSync(symlinkTarget, "outside target\n");
  const symlinkPath = join(root, "linked.txt");
  symlinkSync(symlinkTarget, symlinkPath);
  expectBlocked(symlinkPath, "outbound.symlink", { root, confirmedOutsidePaths: [symlinkPath] });

  const linkedDir = join(root, "linked-dir");
  symlinkSync(outside, linkedDir);
  expectBlocked(join(linkedDir, "safe.txt"), "outbound.symlink", { root, confirmedOutsidePaths: [join(linkedDir, "safe.txt")] });

  const outsideLinkTarget = join(outside, "real-dir");
  mkdirSync(outsideLinkTarget);
  const outsideLink = join(outside, "link-dir");
  symlinkSync(outsideLinkTarget, outsideLink);
  const outsideLinkedFile = join(outsideLink, "safe.txt");
  writeFileSync(outsideLinkedFile, "outside linked file\n");
  expectBlocked(outsideLinkedFile, "outbound.symlink", { root, confirmedOutsidePaths: [outsideLinkedFile] });

  const outsideSafePath = join(outside, "safe.md");
  writeFileSync(outsideSafePath, "explicit outside context\n");
  expectBlocked(outsideSafePath, "outbound.outside_repo_confirmation_required", { root, textOnly: true });
  const confirmed = readOutboundFile(outsideSafePath, {
    root,
    textOnly: true,
    confirmedOutsidePaths: [outsideSafePath],
  });
  assert.equal(confirmed.text, "explicit outside context\n");
  assert.equal(confirmed.realpathInside, false);

  const outsideSecretPath = join(outside, ".env");
  writeFileSync(outsideSecretPath, "SEC" + "RET=never-upload-this-value\n");
  expectBlocked(outsideSecretPath, "outbound.secret_path_blocked", {
    root,
    confirmedOutsidePaths: [outsideSecretPath],
  });

  const outsideSshDir = join(outside, ".ssh");
  mkdirSync(outsideSshDir);
  const outsideSshPath = join(outsideSshDir, "config");
  writeFileSync(outsideSshPath, "Host example\n");
  expectBlocked(outsideSshPath, "outbound.secret_path_blocked", {
    root,
    confirmedOutsidePaths: [outsideSshPath],
  });

  const outsideContentSecretPath = join(outside, "notes.txt");
  writeFileSync(outsideContentSecretPath, "SERVICE_" + "TOK" + "EN=" + "Rq7xM2nP9vL4sT8wY6zA1bC3dE5fG7hJ9kL2mN4pQ\n");
  expectBlocked(outsideContentSecretPath, "outbound.secret_content_blocked", {
    root,
    textOnly: true,
    confirmedOutsidePaths: [outsideContentSecretPath],
  });

  const tooLargePath = join(root, "large.txt");
  writeFileSync(tooLargePath, "1234567890");
  expectBlocked(tooLargePath, "outbound.file_too_large", { root, maxFileBytes: 5 });

  const binaryPath = join(root, "document.pdf");
  writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3]));
  expectBlocked(binaryPath, "outbound.nul_byte", { root, textOnly: true });
  const binary = readOutboundFile(binaryPath, { root });
  assert.deepEqual([...binary.buffer], [0, 1, 2, 3]);

  const opaquePath = join(root, "opaque.bin");
  writeFileSync(opaquePath, Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from("SERVICE_" + "TOK" + "EN=" + "Rq7xM2nP9vL4sT8wY6zA1bC3dE5fG7hJ9kL2mN4pQ", "ascii"),
  ]));
  expectBlocked(opaquePath, "outbound.secret_content_blocked", { root });

  const nulPath = join(root, "nul.txt");
  writeFileSync(nulPath, Buffer.from("before\u0000after", "utf8"));
  expectBlocked(nulPath, "outbound.nul_byte", { root, textOnly: true });

  const invalidUtf8Path = join(root, "invalid.txt");
  writeFileSync(invalidUtf8Path, Buffer.from([0xc3, 0x28]));
  expectBlocked(invalidUtf8Path, "outbound.invalid_utf8", { root, textOnly: true });

  assert.equal(readFileSync(safePath, "utf8"), "safe outbound note\n");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "outbound-security" }, null, 2));
