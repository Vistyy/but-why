# But Why command guidance

Resolve one But Why command prefix before you run a But Why command.
Use `just by` in the But Why source repository.
After But Why is published, use `pnpx but-why` or `npx -y but-why` from the published package.
Do not use the published-package prefixes for an unreleased Candidate.
Use the resolved prefix for every But Why command in the session.

Use the default TOON output when you read a command result directly.
Use `--output json` only when a program parses the command result.
Put `--output` before the command.

Use CLI `--help` output for exact command syntax.

After each But Why command, inspect its structured output and exit code.
For a read-only command, verify that the output contains the requested information.
For a mutation, run the applicable show or status command and verify the resulting persisted state.
When no read command exists, inspect the configuration or state artifact identified by the setup guide.

A read-only CLI operation is complete when its output and exit code demonstrate the requested behavior.
A mutating CLI operation is complete when its output, exit code, and resulting persisted state demonstrate the requested behavior.
