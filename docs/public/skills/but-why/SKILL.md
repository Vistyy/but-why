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

After each But Why CLI command, inspect its structured output and exit code.
For a read-only command, verify that the output contains the requested information.
For a mutation, run the applicable show or status command and verify the resulting persisted state.
When no read command exists, inspect the configuration or state artifact identified by the setup guide.
Treat the operation as complete only when the command reports the requested result and the observable evidence agrees.

Setup is complete when every mandatory setup step succeeds, the resolved prefix succeeds with `--help`, and each required configuration or state artifact contains the documented state.
When the user selects an optional setup step, setup is complete only after that optional step also succeeds.
A read-only CLI operation is complete when its output and exit code demonstrate the requested behavior.
A mutating CLI operation is complete when its output, exit code, and resulting persisted state demonstrate the requested behavior.

When implementing a Change in its Managed Worktree, follow [Implement a Change](references/implement-change.md).
