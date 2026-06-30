---
status: accepted
---

# Support JSON for programmatic CLI consumers

But Why? keeps TOON as the default stdout format for AXI-style agent shell use, but also treats programmatic CLI consumers as a first-class v1 consumer type.
Commands should produce structured result objects before serialization, and the CLI output boundary may serialize those results as TOON or JSON.
Domain modules must not depend on either stdout encoding.

## Considered Options

- Use only TOON because agents are the first consumer.
- Replace TOON with JSON everywhere.
- Keep TOON as the default and support JSON at the serializer boundary.

## Consequences

Stdout formats are external API contracts.
CLI behavior tests should verify the selected serializer without pushing TOON or JSON details into task lifecycle modules.
