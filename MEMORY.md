# Project Memory

## Durable facts

- This repository is the user's fork of the Codex ChatGPT Pro plugin.
- The local fork is the development source. The packaged plugin is materialized under `plugins/codex-chatgpt-pro-plugin/`.
- Preserve user-owned governance files and unrelated worktree changes.

## Security constraints

- Treat browser control, ChatGPT login state, local CDP access, file uploads, context generation, and history artifacts as security-sensitive.
- Do not enter passwords, OTPs, or CAPTCHA responses for the user.
- Test installation must be reversible and must not overwrite an existing installed marketplace version without a state capture.

## Known runtime risks

- Do not launch the dedicated logged-in Chrome profile or make live calls until the browser-control security review is addressed.
- Explicit upload and context paths now use one containment, symlink, secret-scan, and exact outside-path confirmation gate. Binary uploads remain supported and receive path, symlink, size, and byte-level secret checks; full semantic scanning is stronger for text inputs.
- Browser operations need strict `https://chatgpt.com` origin checks and profile or process ownership checks.
- History export needs alias validation, output containment, symlink rejection, `0700` directories, and `0600` atomic files.
- The localhost CDP endpoint is loopback-only but unauthenticated. A local process running as the user can control the logged-in browser.
- The outbound validator uses canonical-path reads and descriptor identity checks. A malicious parent-directory swap at the exact authorization boundary remains a theoretical residual; this is accepted for the user's controlled single-user Mac environment.
- Model/intelligence selection defaults to the account/browser current choice. Explicit CLI level/intelligence and model values take precedence over environment values; `CHATGPT_DEFAULT_LEVEL` is optional and unset by default.
- CDP page selection is fail-closed when a URL matcher is supplied: an unmatched page returns `browser.target_not_found` with available page URLs and never falls back to `about:blank` or another page. With no matcher, the existing first-page behavior remains.
- Browser-profile lock recovery reclaims a confirmed-dead owner immediately, even with a fresh heartbeat; unknown owners still require the stale-age rule, and live owners remain busy.
- Lock reclamation claims an in-lock marker and rechecks the lock directory identity before removal, so a replacement owner cannot be removed by an old claimant; initialization age uses an explicit marker or directory time before heartbeat data exists.

## Collaboration contract

- A successful ChatGPT response is working advice, not task completion. Codex must read the full answer and receipt, extract and validate recommendations, execute safe in-scope actions, verify direct evidence, and repeat in the same room with the evidence delta when needed. The consultation cap applies to calls only; safe in-scope work continues.
- `CHATGPT_THREAD_ECHO=summary` is the recommended interactive mode: it keeps the complete answer and transcript in local artifacts and visible in ChatGPT, but sends Codex a bounded action summary and compact receipt. Summary lines are untrusted candidate text; the active Codex turn must validate, act, verify, and continue or re-call as needed because the CLI cannot enforce arbitrary edits.
