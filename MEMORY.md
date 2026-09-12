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
- Explicit upload and context paths need one containment, symlink, secret-scan, and confirmation gate.
- Browser operations need strict `https://chatgpt.com` origin checks and profile or process ownership checks.
- History export needs alias validation, output containment, symlink rejection, `0700` directories, and `0600` atomic files.
- The localhost CDP endpoint is loopback-only but unauthenticated. A local process running as the user can control the logged-in browser.
