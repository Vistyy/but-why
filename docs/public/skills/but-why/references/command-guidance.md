# But Why command guidance

Resolve one But Why command prefix before you run a But Why command.
Use `just by` in the But Why source repository.
After But Why is published, use `pnpx but-why` or `npx -y but-why` from the published package.
Do not use the published-package prefixes for an unreleased Candidate.
Let `<but-why>` represent the resolved prefix in packaged instructions.
Use that prefix for every But Why command in the session.

Every But Why command returns one compact JSON document on stdout.
Decode the JSON before using result fields in a program.

Use CLI `--help` output when you need to discover or confirm exact command syntax.

After each But Why command, inspect its structured output and exit code.
For a read-only command, verify that the output contains the requested information.
For a successful mutation, treat every returned committed field as authoritative verification.
Run the applicable show or status command only when required verification state is omitted from the mutation result.
For a content mutation, use the complete persisted text in the successful result when that text is required for verification.
When no read command exists, inspect the configuration or state artifact identified by the setup guide.

A read-only CLI operation is complete when its output and exit code demonstrate the requested behavior.
A mutating CLI operation is complete when its output and exit code demonstrate the requested behavior and any required state omitted from its result is verified through the applicable inspection path.
