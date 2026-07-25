---
status: accepted
---

# Use a fixed Validation Gate through Sandcastle

But Why uses a fixed read-only Validation Gate instead of a generic pipeline language.
Repositories configure Checks and reviewers inside the fixed phases, but they do not define arbitrary phases or step types.
Sandcastle provides the v1 Validation Workspace, sandbox, command, and reviewer-process execution behind thin But Why domain seams.

## Considered Options

- Build a generic validation pipeline and custom execution engine.
- Treat validation as one opaque repository command.
- Keep fixed domain phases and delegate execution mechanics to Sandcastle.

## Consequences

But Why owns Validation Runs, phases, Findings, Artifacts, temporary Git refs, and tooling-failure diagnostics.
Sandcastle owns disposable workspace and process mechanics exposed by its supported API.
But Why retains local behavior that Sandcastle does not support, including reviewer-output correction and domain-specific evidence recording.
The Sandcastle integration must remain behind domain-specific seams so another provider can replace it without changing Validation Gate behavior.
