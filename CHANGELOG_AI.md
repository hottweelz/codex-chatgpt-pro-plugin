# AI Change Log

Newest entries go first.

## 2026-09-12T18:06:25Z — Codex

- Task summary: Harden the outbound file/context boundary after the user prioritized that concern and classified CDP as an accepted edge case, origin/profile as a yellow flag, and history/observer concerns as lower priority.
- Selected agent team: Codex lead; STE Security Auditor (`/Users/jamestylee/AI-STE/ste/.ai/agents/security-auditor.md`); outbound gate design review.
- Changes made: Added `readOutboundFile()` and shared text-type detection to `src/repo-context-security.mjs`. Routed prompt files, context files, recognized context-directory files, explicit uploads, and generated repo context through the validator. Added exact `--confirm-outside-repo=/absolute/path` semantics, protected-path checks on absolute and canonical paths, in-repo and outside symlink-component rejection, canonical-path reads with `O_NOFOLLOW` and file identity checks, strict UTF-8/NUL checks for text, byte-level fallback scanning for binary/unknown files, and a default 50 MiB per-file limit via `CHATGPT_OUTBOUND_MAX_FILE_BYTES`. Added focused negative tests and documentation. Synchronized the materialized plugin.
- Files touched: `src/repo-context-security.mjs`, `src/chatgpt-upload.mjs`, `src/context-envelope.mjs`, `scripts/chatgpt-call.mjs`, `scripts/outbound-security-selftest.mjs`, related upload/context self-tests, `package.json`, `README.md`, `.codex/skills/chatgpt-pro-line/SKILL.md`, and synchronized copies under `plugins/codex-chatgpt-pro-plugin/`.
- Commands/tests run: `npm run plugin:sync`; focused outbound, upload, context-envelope, and repo-context tests; full `npm run test:v1`; `npm audit --audit-level=high`; `git diff --check`; source/materialized `cmp`; HomeBoss plan and review gates.
- Results: Focused and full v1 suites passed. npm audit reports 0 vulnerabilities. Package parity checks passed. The materialized package was reinstalled and its `status` check passed. HomeBoss review recorded one exact-time parent-directory swap race as a residual; the user-approved environment makes that out of scope for this change. The bounded release-check was approved. No browser launch, login, upload, or live ChatGPT call occurred.
- Decisions made: Exact outside-file confirmation is required per path. Confirmation does not bypass secret, symlink, type, or size checks. Binary uploads remain available. The remaining exact-time parent-directory swap race is accepted as a theoretical residual for this controlled environment and is not a reason to block this bounded change.
- Lessons learned:
  - Mistake: The first validator revision only scanned recognized text extensions and skipped parent symlink checks for outside paths.
  - Root Cause: Binary/unknown inputs can contain ASCII secrets despite invalid UTF-8, and macOS `/var`/`/tmp` aliases require canonicalization before symlink traversal checks.
  - Future Trigger: Any new file-like input, upload mode, context envelope, or path normalization change.
  - Required Behavior Change: Route every outbound file-like input through the shared validator; test both normal and adversarial paths, including macOS system aliases.
  - Verification Gate: `npm run test:outbound-security` and `npm run test:v1` pass after final `npm run plugin:sync`; source and materialized files compare equal.
  - Durable Memory Update: Updated `MEMORY.md` with the outbound gate and accepted TOCTOU residual.
- Known issues: Yellow — browser origin/profile attestation is not yet strict. Accepted edge cases — loopback CDP has no authentication; observer/history hardening remains pending. The outbound gate still depends on heuristic secret scanning and cannot semantically inspect arbitrary binary formats.
- Next recommended steps: If desired, implement strict ChatGPT origin/profile attestation next; keep live testing limited to trusted non-sensitive prompts until that yellow flag is addressed.
- Notes for the next agent: Use `--confirm-outside-repo=/absolute/path` once for each deliberate outside file. Do not use `--confirm-repo-context-upload` as a substitute; it only confirms generated repo context.
- MEMORY.md update: completed.
- GitHub sync: pending at handoff-write time; commit only intended files and verify `HEAD...@{u}` is `0 0`.

## 2026-09-12T17:32:07Z — Codex

- Task summary: Review the fork, install it as a local Codex plugin on this Mac, and repair installation defects found during testing.
- Selected agent team: Codex lead; STE Security Auditor (`/Users/jamestylee/AI-STE/ste/.ai/agents/security-auditor.md`).
- Changes made: Added project continuity files. Fixed packaged `chatgpt-pro init` to read the shipped skill path. Extended isolated install smoke to execute installed `init`. Added safe handling for a drifted skill: warning on skip and UUID/exclusive backup before forced replacement. Synchronized the materialized plugin. Installed and enabled local plugin version 0.1.0 from this checkout.
- Files touched: `MEMORY.md`, `CHANGELOG_AI.md`, `bin/chatgpt-pro`, `scripts/cli-init-selftest.mjs`, `scripts/plugin-install-smoke.mjs`, and synchronized copies under `plugins/codex-chatgpt-pro-plugin/`.
- Commands/tests run: `npm ci`; `npm audit --audit-level=high`; `npm run plugin:sync`; repeated `npm run test:v1`; isolated plugin install smoke; real `codex plugin marketplace add`; real `codex plugin add`; installed `chatgpt-pro init`; installed `chatgpt-pro status`; `git diff --check`; source/package `cmp`; HomeBoss plan, review, and release-check gates.
- Results: Final deterministic and v1 suites passed after the last package sync. npm audit found 0 vulnerabilities. Local plugin is installed, enabled, initialized, and reports clean registry status. Browser was not launched. No login, upload, or live ChatGPT call occurred. Installer review findings for backup collision and symlink overwrite were fixed and regression-tested. Release-check remained blocked for live use because the primary browser function is intentionally disabled pending security remediation; this is an accepted test-install limitation, not a live-release approval.
- Decisions made: Keep the plugin installed for static and installer testing. Do not open the logged-in browser or use live calls until runtime security findings are fixed.
- Lessons learned:
  - Mistake: The installed-package smoke test checked file presence but did not execute `init`; the initial package therefore installed but failed at first use. A later exclusive-copy import used the wrong Node export and caused one transient failed test run.
  - Root Cause: The root checkout contains `.codex/skills`, but the materialized plugin ships `skills`; tests exercised the source path. The exclusive-copy flag belongs to `fs.constants`.
  - Future Trigger: Any materialized plugin, installer, or package-layout change.
  - Required Behavior Change: Execute the installed CLI from its cached package in an isolated repository and isolated state home. Run the full suite after the last source-to-package sync.
  - Verification Gate: Installed `init` must return `ok: true`; two forced updates must make different backups and preserve the first; a symlink target must be rejected without modifying its referent; `npm run test:v1` must pass after final sync.
  - Durable Memory Update: Added the live-use security stop condition and prioritized risk boundaries to `MEMORY.md`.
- Known issues: High — unauthenticated local CDP control; explicit upload/context paths bypass common outbound-data checks; browser origin/profile ownership is not strictly enforced. Medium — history path containment/permissions/symlinks and unauthenticated run observer. Low — read-like commands can write project state. Live use is not approved.
- Next recommended steps: Fix outbound-data controls and browser origin/profile enforcement first, then fix history export and CDP/broker design, add negative security tests, rerun the full suite, and only then perform a visible login and live smoke test.
- Notes for the next agent: The local marketplace name is `codex-chatgpt-pro-plugin`; installed plugin id is `codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin`. Uninstall with `codex --enable plugins plugin remove codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin`, then remove the marketplace with `codex --enable plugins plugin marketplace remove codex-chatgpt-pro-plugin`.
- MEMORY.md update: completed.
- GitHub sync: completed to `origin/main` in commit `b8c5822`; post-push `HEAD...@{u}` was `0 0`. The final ledger-only correction follows in the next commit.
