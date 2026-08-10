---
status: accepted
supersedes: 0002-support-json-for-programmatic-cli-consumers
---

# Use JSON as the only CLI result format

But Why returns each CLI result as one compact JSON document followed by one line feed.
Commands construct decision-oriented structured result objects before the CLI output boundary serializes them.
Domain modules do not depend on stdout serialization.
The CLI does not provide runtime output-format selection.
[`docs/cli-output.md`](../cli-output.md) defines the current output contract.

## Considered Options

- Keep multiple selectable result encodings.
- Replace the selector with another output-format option.
- Use compact JSON for every result without format selection.

## Consequences

Stdout result schemas, output channels, and exit statuses remain external API contracts.
Agents and programs decode the same JSON result without changing command syntax.
The source launcher, packaged launcher, and portable extensions use the same selector-free command syntax.
