---
status: accepted
---

# Use a fixed Validation Gate through Sandcastle

But Why uses a fixed read-only Validation Gate instead of a generic pipeline language.
Repositories configure Checks and reviewers inside the fixed phases, but they do not define arbitrary phases or step types.
Sandcastle provides the v1 disposable Validation Workspace and host process execution behind thin But Why domain seams.

## Considered Options

- Build a generic validation pipeline and custom execution engine.
- Treat validation as one opaque repository command.
- Keep fixed domain phases and delegate execution mechanics to Sandcastle.

## Consequences

But Why owns Validation Runs, phases, Findings, Artifacts, temporary Git refs, and tooling-failure diagnostics.
Sandcastle owns disposable workspace and process mechanics exposed by its supported API.
But Why retains local behavior that Sandcastle does not support, including reviewer-output correction and domain-specific evidence recording.
Sandcastle host cancellation does not prove that the reviewer process tree stopped.
V1 therefore supports explicit Validation Run Abandonment after the operator stops remaining processes and defers automatic interrupted-run recovery until an execution provider supplies bounded descendant ownership.
The Sandcastle integration must remain behind domain-specific seams so another provider can replace it without changing Validation Gate behavior.
