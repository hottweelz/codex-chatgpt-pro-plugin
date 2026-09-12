# AI Change Log

Newest entries go first.

## 2026-09-12T19:19:04Z — Codex

- Task summary: Make the ChatGPT-to-Codex workflow act on GPT advice instead of stopping after displaying the thread echo, while keeping consultation bounded and safe.
- Selected agent team: Codex lead; consultation-loop documentation/test worker (`/root/consultation_loop_contract`); STE Testing Test Engineer guidance.
- Changes made: Added a synchronized Consultation Loop Contract to the development skill, packaged skill, call-contract documentation, and READMEs. The contract defines `call -> read -> extract -> validate -> act -> verify`, requires full answer and receipt review, recommendation extraction, scope and `AGENTS.md` validation, direct evidence after action, same-room follow-ups with evidence and delta, explicit rejection of unsafe/destructive/credential/secret/scope-expanding advice, and user escalation only for missing authorization or unresolved scope conflicts. It explicitly says the thread echo is not completion and that the three-call cap ends further consultation only; safe in-scope work continues. Strengthened package-surface assertions for semantic wording and copy parity. Updated durable project memory.
- Files touched: `.codex/skills/chatgpt-pro-line/SKILL.md`, `skills/chatgpt-pro-line/SKILL.md`, `plugins/codex-chatgpt-pro-plugin/skills/chatgpt-pro-line/SKILL.md`, `docs/chatgpt-call-contract.md`, `plugins/codex-chatgpt-pro-plugin/docs/chatgpt-call-contract.md`, `README.md`, `plugins/codex-chatgpt-pro-plugin/README.md`, `scripts/package-surface-selftest.mjs`, `plugins/codex-chatgpt-pro-plugin/scripts/package-surface-selftest.mjs`, and `MEMORY.md`.
- Commands/tests run: `npm run plugin:sync`; root `npm run test:package-surface`; packaged `node plugins/codex-chatgpt-pro-plugin/scripts/package-surface-selftest.mjs`; `npm run test:deterministic`; `npm run test:v1`; `git diff --check`; byte-parity checks for all synchronized surfaces; HomeBoss plan, review, and release-check gates.
- Results: Package-surface, packaged self-test, deterministic, and v1 readiness suites passed. All synchronized skill, README, contract, and self-test copies are byte-identical where required. HomeBoss plan, review, and release-check gates all returned `APPROVED`. No runtime transport file changed. Five accidental zero-byte gate-artifact files were moved to a uniquely named macOS Trash folder; unrelated governance adapters remain untracked and untouched.
- Decisions made: The CLI remains a transport layer; the installed Codex skill owns the action loop. A successful echo must be followed by action/verification, not a final display. Stop consultation when acceptance criteria are met or the task-wide cap is reached; the cap applies to initial, failed, and retried consultation calls and does not block safe work.
- Lessons learned:
  - Mistake: A gate command used shell backticks inside a double-quoted task string and created empty files named `act`, `extract`, `read`, `validate`, and `verify`.
  - Root Cause: The shell evaluated command substitutions before invoking HomeBoss.
  - Future Trigger: Any shell command containing Markdown backticks or other command-substitution syntax.
  - Required Behavior Change: Use single-quoted task strings or escape shell metacharacters; inspect untracked artifacts immediately after a gate command.
  - Verification Gate: Confirm the exact artifacts are zero-byte, move only those paths to recoverable Trash, then rerun status and all tests.
  - Durable Memory Update: Added the Consultation Loop Contract rule to `MEMORY.md`.
- Known issues: The loop is an instruction contract, not an autonomous arbitrary-command executor; Codex still evaluates GPT advice against user scope and repository governance. Browser origin/profile attestation, unauthenticated loopback CDP, history/observer hardening, and the accepted outbound TOCTOU residual remain unchanged.
- Next recommended steps: Refresh the installed local plugin cache, then run one harmless same-room consultation where GPT proposes a small in-scope change and verify that Codex applies and tests it before requesting a follow-up critique.
- Notes for the next agent: Keep the current Chrome session running. Use the installed `codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin` package and omit model/intelligence overrides unless a specific available choice is required. Do not add the untracked governance adapters to the commit.
- MEMORY.md update: completed.
- GitHub sync: pending at handoff-write time; commit only the staged intended files, push to the tracked `origin/main`, fetch/prune, and verify `HEAD...@{u}` is `0 0`.

## 2026-09-12T18:42:45Z — Codex

- Task summary: Remove the hardcoded Pro intelligence default that blocked calls for accounts exposing GPT-5.6 Sol/GPT-5.5, and verify the new account-default behavior live.
- Selected agent team: Codex lead; STE Testing Test Engineer (`/Users/jamestylee/AI-STE/ste/.ai/agents/testing-test-engineer.md`) for the model-selection test review.
- Changes made: Added `src/intelligence-policy.mjs` with trimmed precedence resolution for account default, optional environment level, CLI level/intelligence, CLI model, and environment model. Updated `scripts/chatgpt-call.mjs` to preserve the site/account current selection when no override exists, to parse `--model`, and to record selection sources in receipts. Updated root/materialized README, skill, and call-contract docs. Added resolver regression tests and synchronized/reinstalled the plugin.
- Files touched: `src/intelligence-policy.mjs`, `scripts/intelligence-policy-selftest.mjs`, `scripts/chatgpt-call.mjs`, `package.json`, docs/skills, and synchronized copies under `plugins/codex-chatgpt-pro-plugin/`; `MEMORY.md`.
- Commands/tests run: `npm run plugin:sync`; `npm run test:intelligence-policy`; full `npm run test:v1`; `npm audit --audit-level=high`; `git diff --check`; source/materialized parity checks; local plugin remove/add; installed `doctor --live`; fresh live call with `CHATGPT_DEFAULT_LEVEL`, `CHATGPT_LEVEL`, `CHATGPT_INTELLIGENCE`, `CHATGPT_MODEL` unset; receipt and transcript verification; HomeBoss plan, review, and release-check gates.
- Results: All deterministic/v1 tests passed. npm audit found 0 vulnerabilities. Installed plugin version 0.1.0 refreshed successfully. Live doctor passed. Account-default live call returned exactly `ACCOUNT_DEFAULT_OK`; receipt recorded `read-choices`, no `set-choices`, null desired level/model, and `account-default` sources. Account reports Plus with GPT-5.6 Sol current and GPT-5.5 available. No uploads or repo context were used.
- Decisions made: Do not assume plan-specific labels. Keep `CHATGPT_DEFAULT_LEVEL` as an explicit opt-in override. Keep `--no-default-pro` as a compatibility switch. CLI `--model` now matches existing environment support.
- Lessons learned:
  - Mistake: The previous default requested a selector named `Pro`, which was unavailable on this account and caused a valid call to fail before send.
  - Root Cause: Plan/product naming was treated as a universal live intelligence selector.
  - Future Trigger: ChatGPT UI/account model or intelligence changes, new plan labels, or selector errors.
  - Required Behavior Change: Let the live site retain its current available selection unless the user explicitly configures a selector; record the source and actual choices in receipts.
  - Verification Gate: Resolver precedence tests, full `npm run test:v1`, package install smoke, and a live no-override call whose receipt uses `read-choices` and `account-default`.
  - Durable Memory Update: Added the account-default selection rule to `MEMORY.md`.
- Known issues: Explicit overrides can still fail clearly when a requested label is unavailable; that is intentional. Browser origin/profile and accepted local-CDP edge cases remain unchanged.
- Next recommended steps: Use the installed plugin for normal calls without setting a default level; add a named room only when continuity is needed.
- Notes for the next agent: To force a choice, use `--level=<available-level>` or `--model=<available-model>` after `levels:list`/`choices:list`. Omit them for account-default behavior.
- MEMORY.md update: completed.
- GitHub sync: pending at handoff-write time; commit only the staged model-selection files and verify `HEAD...@{u}` is `0 0`.

## 2026-09-12T18:25:46Z — Codex

- Task summary: Remove the superseded `codex-chatgpt-line` plugin while keeping the new `codex-chatgpt-pro-plugin` browser and installation active.
- Selected agent team: Codex lead; no additional worker needed for this bounded cleanup.
- Changes made: Confirmed no old plugin registration or old process was active. Moved the old global skill, old runtime state including `broker.token` and Chrome profile, old source checkout/worktrees, and three old Claude CLI cache directories to macOS Trash. Preserved historical Codex/Claude conversation logs and memory text. Did not kill Chrome or touch the new `/Users/jamestylee/.chatgpt-pro-codex/chrome-profile`.
- Files touched: `CHANGELOG_AI.md` only. Cleanup targets were external active artifacts, moved reversibly to `/Users/jamestylee/.Trash/*-old-plugin-20260912T182546Z`.
- Commands/tests run: Codex plugin list/marketplace inventory; old manifest/package and uninstall-script inspection; old process check; explicit active-path checks; `curl http://127.0.0.1:9222/json/version`; new-profile process check; new plugin list check.
- Results: Old active paths are absent: `/Users/jamestylee/.codex/skills/chatgpt-line`, `/Users/jamestylee/.codex-chatgpt-line`, `/Users/jamestylee/Projects/codex-chatgpt-line`, and related caches. New Chrome remains running with PID 96270 and the new profile. New plugin `codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin` remains installed and enabled. No source/browser process was killed.
- Decisions made: Treat the old source checkout and runtime as superseded active artifacts and move them to recoverable Trash. Leave historical logs/memory references because they are not active plugin artifacts.
- Lessons learned:
  - Mistake: none.
  - Root Cause: The old plugin was not registered in current Codex plugin metadata, but its global skill, 911 MB runtime/profile, source checkout, and caches remained.
  - Future Trigger: Any plugin replacement or request to remove a superseded integration.
  - Required Behavior Change: Inventory registration, processes, skills, state, profiles, source, and caches separately; preserve the replacement browser/profile and historical records.
  - Verification Gate: Old active paths absent, old process absent, new CDP endpoint reachable, and new plugin still enabled.
  - Durable Memory Update: not needed; cleanup scope and separation are recorded here.
- Known issues: Recoverable Trash copies remain until Trash is emptied. Historical memory/session logs still contain the old project name by design.
- Next recommended steps: Continue testing only through the new `codex-chatgpt-pro-plugin`; empty the listed Trash items only if permanent deletion is later requested.
- Notes for the next agent: New profile is `/Users/jamestylee/.chatgpt-pro-codex/chrome-profile`; do not remove it when cleaning old artifacts.
- MEMORY.md update: not needed.
- GitHub sync: pending at handoff-write time; commit this ledger entry and verify `HEAD...@{u}` is `0 0`.

## 2026-09-12T18:17:14Z — Codex

- Task summary: Run the first controlled live test of the installed local plugin after the user completed visible ChatGPT login.
- Selected agent team: Codex lead; no additional worker needed for this bounded runtime smoke.
- Changes made: None to source. Reused the installed and enabled local plugin `codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin` version `0.1.0`.
- Files touched: Runtime artifacts only under `.devspace/runs/2026-09-12T18-16-34-126Z-chatgpt-call/`; no tracked source files changed.
- Commands/tests run: installed `chatgpt-pro doctor --live`; installed `chatgpt-pro call --fresh --repo-context=off --no-default-pro --prompt='Reply with exactly: PROBE_OK'`; installed `chatgpt-pro transcript verify --receipt=.devspace/runs/2026-09-12T18-16-34-126Z-chatgpt-call/receipt.json`; installed `chatgpt-pro status --alias=main`.
- Results: Doctor passed with logged-in ChatGPT at `https://chatgpt.com/`, composer detected, Plus plan, and GPT-5.6 Sol intelligence. The fresh no-upload probe passed in 28.5 seconds and returned exactly `PROBE_OK`. Transcript verification passed with recorded sent/received/transcript SHA-256 values. Browser lock acquired and released cleanly. No credentials were entered by automation. No repository context or file upload was used.
- Decisions made: Treat the local transport as operational for non-sensitive no-upload calls. Do not claim Pro entitlement; the account reports Plus. Keep the browser profile open for follow-up testing.
- Lessons learned:
  - Mistake: none.
  - Root Cause: none.
  - Future Trigger: Any live call, upload, browser restart, or room-binding test.
  - Required Behavior Change: Keep the first calls fresh, explicit `--repo-context=off`, and no-upload until a specific broader test is requested.
  - Verification Gate: `doctor --live` pass, exact probe response, transcript verification pass, and clean lock release.
  - Durable Memory Update: Not needed; this is current runtime evidence already covered by project continuity.
- Known issues: Account is Plus rather than Pro. Origin/profile yellow flag, local CDP acceptance, history/observer edge cases, and the outbound validator residual remain as previously documented.
- Next recommended steps: If desired, bind a named `main` room and run a second harmless text-only call; request an explicit upload test only when ready to exercise the new outbound gate.
- Notes for the next agent: Fresh probe conversation URL was `https://chatgpt.com/c/6aa59703-d06c-83e9-87e4-fec6e6f6717d`. Receipt and transcript are local runtime artifacts and were not committed.
- MEMORY.md update: not needed.
- GitHub sync: no source changes in this live-test handoff; repository remains synchronized from commit `62fda09`.

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
- GitHub sync: completed in commit `5124fd8`; `git fetch --prune origin` and `git rev-list --left-right --count HEAD...@{u}` returned `0 0`. Pre-existing untracked governance adapters remain untouched.

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
