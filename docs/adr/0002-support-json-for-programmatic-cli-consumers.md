---
status: superseded
superseded-by: 0011-use-json-as-the-only-cli-result-format
---

# Support JSON for programmatic CLI consumers

But Why? keeps TOON as the default stdout format for AXI-style agent shell use, but also treats programmatic CLI consumers as a first-class v1 consumer type.
Commands should produce structured result objects before serialization, and the CLI output boundary may serialize those results as TOON or JSON.
Each command uses one decision-oriented result schema for both formats instead of serializing complete domain records or selecting fields by format.
Domain modules must not depend on either stdout encoding.
[`docs/cli-output.md`](../cli-output.md) defines the current project output policy.

## Considered Options

- Use only TOON because agents are the first consumer.
- Replace TOON with JSON everywhere.
- Keep TOON as the default and support JSON at the serializer boundary.

## Consequences

Stdout formats and command result schemas are external API contracts.
A decision-oriented default reduces agent context, but callers must use explicit expansion commands to retrieve evidence owned by narrower inspections.
CLI behavior tests should verify the selected serializer without pushing TOON or JSON details into task lifecycle modules.
