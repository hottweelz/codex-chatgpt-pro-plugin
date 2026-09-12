import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { parse, relative, resolve, sep } from "node:path";

const SECRET_PATH_RULES = [
  ["env_file", /(^|\/)\.env(\..*)?$/i],
  ["npmrc", /(^|\/)\.npmrc$/i],
  ["pypirc", /(^|\/)\.pypirc$/i],
  ["netrc", /(^|\/)\.netrc$/i],
  ["private_key", /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i],
  ["ssh_config", /(^|\/)\.ssh\//i],
  ["gnupg", /(^|\/)\.gnupg\//i],
  ["aws_config", /(^|\/)\.aws\//i],
  ["kube_config", /(^|\/)(\.kube\/config|kubeconfig)$/i],
  ["credential_file", /(^|\/)(credentials?|secrets?|service-account|google-credentials)(\.[^/]*)?$/i],
  ["key_material", /\.(pem|key|p12|pfx)$/i],
];

const CONTENT_RULES = [
  ["private_key_block", /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/],
  ["openai_key", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{24,}\b/],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["npm_token", /\/\/[^:\s]+\/?:_authToken\s*=\s*[A-Za-z0-9_\-.]{20,}/],
];

const SECRETISH_ASSIGNMENT =
  /\b([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|pwd|private[_-]?key|access[_-]?key|client[_-]?secret|authorization|credential)[A-Za-z0-9_-]*)\b\s*[:=]\s*["']?([A-Za-z0-9_+./=-]{20,})/gi;

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".diff",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".patch",
  ".py",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function normalizedPath(file) {
  return String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isInside(rootRealpath, targetRealpath) {
  return targetRealpath === rootRealpath || targetRealpath.startsWith(`${rootRealpath}${sep}`);
}

function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    result -= p * Math.log2(p);
  }
  return result;
}

function looksLikePlaceholder(value) {
  return /^(x+|0+|1+|a+|example|placeholder|changeme|replace[_-]?me|your[_-]?)/i.test(value)
    || /example|placeholder|changeme|replace[_-]?me|your[_-]?/i.test(value);
}

export function secretPathFinding(file) {
  const normalized = normalizedPath(file);
  const match = SECRET_PATH_RULES.find(([, pattern]) => pattern.test(normalized));
  if (!match) return null;
  return {
    type: "secret_path",
    rule: match[0],
    file: normalized,
  };
}

export function scanSecretContent(text, file = "") {
  const findings = [];
  for (const [rule, pattern] of CONTENT_RULES) {
    if (pattern.test(text)) {
      findings.push({
        type: "secret_content",
        rule,
        file: normalizedPath(file),
      });
    }
  }

  SECRETISH_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(SECRETISH_ASSIGNMENT)) {
    const value = match[2] || "";
    if (value.length < 20 || looksLikePlaceholder(value)) continue;
    const score = entropy(value);
    if (score < 3.5) continue;
    findings.push({
      type: "secret_entropy",
      rule: "secretish_assignment_high_entropy",
      file: normalizedPath(file),
      key: match[1],
      entropy: Number(score.toFixed(2)),
    });
  }

  return findings;
}

export function repoContextSecurityError(findings, summary = {}) {
  const error = new Error([
    "Repo context bundle blocked: potential secrets or unsafe file paths were detected.",
    "Use --no-repo-context, remove the secret files, or pass explicit scrubbed context files.",
  ].join(" "));
  error.errorCode = "repo_context.secret_scan_blocked";
  error.details = {
    ...summary,
    findings,
  };
  return error;
}

export function scanRepoContextFiles(files, {
  root,
  maxFileBytes = 120_000,
} = {}) {
  const repoRoot = resolve(root || ".");
  const rootRealpath = realpathSync(repoRoot);
  const findings = [];
  const skipped = [];
  let contentScanned = 0;

  for (const file of files) {
    const normalized = normalizedPath(file);
    const absolutePath = resolve(repoRoot, normalized);
    if (!absolutePath.startsWith(repoRoot + sep) && absolutePath !== repoRoot) {
      findings.push({ type: "path_escape", rule: "lexical_root_escape", file: normalized });
      continue;
    }
    if (!existsSync(absolutePath)) {
      skipped.push({ file: normalized, reason: "missing" });
      continue;
    }

    const lstat = lstatSync(absolutePath);
    const realpath = realpathSync(absolutePath);
    if (!isInside(rootRealpath, realpath)) {
      findings.push({
        type: "path_escape",
        rule: "realpath_root_escape",
        file: normalized,
      });
      continue;
    }
    if (lstat.isSymbolicLink()) {
      findings.push({
        type: "symlink",
        rule: "repo_context_symlink",
        file: normalized,
      });
      continue;
    }
    if (!lstat.isFile()) {
      skipped.push({ file: normalized, reason: "not_regular_file" });
      continue;
    }

    const pathFinding = secretPathFinding(normalized);
    if (pathFinding) {
      findings.push(pathFinding);
      continue;
    }

    const stats = statSync(absolutePath);
    if (stats.size > maxFileBytes) {
      skipped.push({ file: normalized, reason: "above_max_file_bytes", bytes: stats.size });
      continue;
    }

    const text = readFileSync(absolutePath, "utf8");
    const contentFindings = scanSecretContent(text, normalized);
    if (contentFindings.length) findings.push(...contentFindings);
    contentScanned += 1;
  }

  return {
    ok: findings.length === 0,
    filesChecked: files.length,
    contentScanned,
    skipped,
    findings,
  };
}

export function isTextLikePath(file) {
  const value = String(file || "");
  return TEXT_FILE_EXTENSIONS.has(value.slice(value.lastIndexOf(".")).toLowerCase());
}

function outboundError(errorCode, message, details = {}) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function pathInside(rootPath, targetPath) {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`);
}

function displayPathFor(rootPath, targetPath) {
  const value = relative(rootPath, targetPath);
  return value && !value.startsWith("..") && value !== "" ? value.replaceAll("\\", "/") : `[outside-repo]/${targetPath.split(sep).at(-1)}`;
}

function confirmedPathSet(paths = []) {
  const values = typeof paths === "string" ? [paths] : [...paths || []];
  return new Set(values.map((value) => resolve(String(value))));
}

function symlinkComponent(path, start = parse(path).root) {
  let current = start;
  const suffix = relative(start, path);
  for (const component of suffix.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return null;
    }
  }
  return null;
}

function canonicalizeSystemAlias(path) {
  for (const alias of ["/var", "/tmp"]) {
    if (path !== alias && !path.startsWith(`${alias}${sep}`)) continue;
    try {
      const canonical = realpathSync(alias);
      return `${canonical}${path.slice(alias.length)}`;
    } catch {
      return path;
    }
  }
  return path;
}

function statIdentity(stats) {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
}

function readFileDescriptor(path, expectedStats) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const openedStats = fstatSync(fd);
    if (!openedStats.isFile()) {
      throw outboundError("outbound.not_regular_file", `Outbound path is not a regular file: ${path}`, { path });
    }
    if (statIdentity(openedStats) !== statIdentity(expectedStats)) {
      throw outboundError("outbound.file_changed", `Outbound file changed while it was being authorized: ${path}`, { path });
    }
    const buffer = readFileSync(fd);
    const finalStats = fstatSync(fd);
    if (statIdentity(finalStats) !== statIdentity(expectedStats)) {
      throw outboundError("outbound.file_changed", `Outbound file changed while it was being read: ${path}`, { path });
    }
    return buffer;
  } catch (error) {
    if (error?.errorCode) throw error;
    if (error?.code === "ELOOP") {
      throw outboundError("outbound.symlink", `Refusing symbolic-link outbound file: ${path}`, { path });
    }
    if (error?.code === "ENOENT") {
      throw outboundError("outbound.file_missing", `Outbound file does not exist: ${path}`, { path });
    }
    throw error;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function readOutboundFile(file, {
  root = process.cwd(),
  confirmedOutsidePaths = [],
  maxFileBytes = 0,
  scanContent = true,
  textOnly = false,
} = {}) {
  const absolutePath = resolve(String(file || ""));
  const rootPath = resolve(root || process.cwd());
  const rootRealpath = realpathSync(rootPath);
  const lexicalInside = pathInside(rootPath, absolutePath);
  let lstat;
  try {
    lstat = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw outboundError("outbound.file_missing", `Outbound file does not exist: ${absolutePath}`, { path: absolutePath });
    }
    throw error;
  }
  if (lstat.isSymbolicLink()) {
    throw outboundError("outbound.symlink", `Refusing symbolic-link outbound file: ${absolutePath}`, {
      path: absolutePath,
      displayPath: displayPathFor(rootPath, absolutePath),
    });
  }
  const symlinkScanPath = canonicalizeSystemAlias(absolutePath);
  const symlinkScanRoot = lexicalInside ? canonicalizeSystemAlias(rootPath) : parse(symlinkScanPath).root;
  const symlink = symlinkComponent(symlinkScanPath, symlinkScanRoot);
  if (symlink) {
    throw outboundError("outbound.symlink", `Refusing outbound path with symbolic-link component: ${absolutePath}`, {
      path: absolutePath,
      component: symlink,
      displayPath: displayPathFor(rootPath, absolutePath),
    });
  }
  if (!lstat.isFile()) {
    throw outboundError("outbound.not_regular_file", `Outbound path is not a regular file: ${absolutePath}`, {
      path: absolutePath,
      displayPath: displayPathFor(rootPath, absolutePath),
    });
  }

  const realpath = realpathSync(absolutePath);
  const realpathInside = pathInside(rootRealpath, realpath);
  const displayPath = displayPathFor(rootPath, absolutePath);
  const pathFinding = [
    secretPathFinding(absolutePath),
    secretPathFinding(realpath),
  ].find(Boolean);
  if (pathFinding) {
    throw outboundError("outbound.secret_path_blocked", "Outbound file path matches a protected secret path.", {
      path: absolutePath,
      displayPath,
      finding: { ...pathFinding, file: displayPath },
    });
  }
  const confirmed = confirmedPathSet(confirmedOutsidePaths);
  if ((!lexicalInside || !realpathInside) && !confirmed.has(absolutePath) && !confirmed.has(realpath)) {
    throw outboundError(
      "outbound.outside_repo_confirmation_required",
      `Outbound file is outside the repository. Confirm this exact path with --confirm-outside-repo=${absolutePath}.`,
      { path: absolutePath, realpath, displayPath, lexicalInside, realpathInside },
    );
  }

  const currentRealpath = realpathSync(absolutePath);
  if (currentRealpath !== realpath) {
    throw outboundError("outbound.file_changed", `Outbound file path changed while it was being authorized: ${absolutePath}`, {
      path: absolutePath,
      displayPath,
      authorizedRealpath: realpath,
      currentRealpath,
    });
  }
  const stats = statSync(realpath);
  if (maxFileBytes > 0 && stats.size > maxFileBytes) {
    throw outboundError(
      "outbound.file_too_large",
      `Outbound file is ${stats.size} bytes, above the limit of ${maxFileBytes}: ${absolutePath}`,
      { path: absolutePath, displayPath, bytes: stats.size, maxFileBytes },
    );
  }

  const textLike = isTextLikePath(absolutePath);
  const buffer = readFileDescriptor(realpath, stats);
  let text = null;
  const shouldDecode = textLike || textOnly || (scanContent && !buffer.includes(0));
  if (shouldDecode) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      if (!textOnly && !textLike) text = null;
      else {
        throw outboundError("outbound.invalid_utf8", `Outbound text input is not valid UTF-8: ${absolutePath}`, {
          path: absolutePath,
          displayPath,
        });
      }
    }
    if (text?.includes("\u0000")) {
      throw outboundError("outbound.nul_byte", `Outbound text input contains a NUL byte: ${absolutePath}`, {
        path: absolutePath,
        displayPath,
      });
    }
  }

  if (scanContent && text == null && buffer.length) {
    const findings = scanSecretContent(buffer.toString("latin1"), displayPath);
    if (findings.length) {
      throw outboundError("outbound.secret_content_blocked", "Outbound binary input contains a potential secret.", {
        path: absolutePath,
        displayPath,
        findings,
      });
    }
  }

  if (scanContent && text != null) {
    const findings = scanSecretContent(text, displayPath);
    if (findings.length) {
      throw outboundError("outbound.secret_content_blocked", "Outbound text input contains a potential secret.", {
        path: absolutePath,
        displayPath,
        findings,
      });
    }
  }

  return {
    path: absolutePath,
    realpath,
    displayPath,
    bytes: stats.size,
    sha256: sha256Bytes(buffer),
    textLike,
    text,
    buffer,
    lexicalInside,
    realpathInside,
  };
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
