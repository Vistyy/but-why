---
status: accepted
---

# Use fixed validation gate phases

But Why? uses an opinionated validation gate with fixed phases instead of a generic CI pipeline language.
Repos can configure checks and reviewers inside those phases, but v1 does not allow arbitrary phase ordering or arbitrary step types.
This keeps But Why? focused on task intent, findings, Validation Runs, and PR readiness while avoiding ownership of a full CI system.

## Considered Options

- Generic pipeline language.
- One opaque validation command.
- Fixed phases with configurable internals.

## Consequences

But Why? can record stable phase and round history.
Repos still own their check commands.
Future versions can add more behavior inside phases without turning the product into a generic workflow engine.
