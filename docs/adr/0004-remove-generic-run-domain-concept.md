---
status: accepted
---

# Remove generic Run as a domain concept

But Why? will not use a generic `Run` as a product-facing domain concept.
Validation uses `Validation Run`, and future loops such as implementation or refinement should get their own names only when they exist.
A shared higher-level loop concept should be introduced later only if multiple real loops prove they share meaningful domain behavior.

## Consequences

- Public docs, CLI commands, IDs, Artifact refs, and Finding scopes use `Validation Run` for validation history.
- Internal validation state names use `Validation Run`, not generic `Run`.
