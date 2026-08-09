---
status: accepted
---

# Use a fixed Validation Gate through Sandcastle

But Why uses a fixed read-only Validation Gate instead of a generic pipeline language.
Repositories configure Checks and reviewers inside the fixed phases, but they do not define arbitrary phases or step types.
Sandcastle provides the v1 disposable Validation Workspace and host process execution behind a neutral disposable-workspace Adapter and thin But Why domain seams.

## Considered Options

- Build a generic validation pipeline and custom execution engine.
- Treat validation as one opaque repository command.
- Keep fixed domain phases and delegate execution mechanics to Sandcastle.

## Consequences

But Why owns Validation Runs, phases, Findings, Artifacts, Reviewer Sessions, temporary Git refs, and tooling-failure diagnostics.
Sandcastle owns disposable workspace and process mechanics exposed by its supported API.
But Why retains reviewer-output correction and domain-specific evidence recording that Sandcastle does not own.
Reviewer Sessions belong to one Change and persist independently from disposable Validation Workspaces so successor Candidates can reuse repository orientation.
Sandcastle host cancellation does not prove that the reviewer process tree stopped, so interrupted reviewer recovery is not automatic.
The Sandcastle integration remains behind the neutral disposable-workspace Adapter and domain-specific execution seams so another provider can replace it without changing Validation Gate behavior.
