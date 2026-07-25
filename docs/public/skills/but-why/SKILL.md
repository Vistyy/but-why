---
name: but-why
description: Use when setting up But Why, running its CLI, or implementing and submitting a But Why Change.
---

# But Why

Resolve one But Why command prefix before running commands.
Use `just by` in the But Why source repository.
Otherwise, use `pnpx but-why` or `npx -y but-why` from the published package.
Use the resolved prefix for every command in the session.
Use the default TOON output when the agent reads a command result directly.
Use `--output json` only when a program parses the command result.

Before setup or workflow guidance, read `docs/public/setup.md` from the installed But Why package or repository.
Use CLI `--help` output for exact command syntax.

When implementing a Change in its Managed Worktree, follow [Implement a Change](references/implement-change.md).
