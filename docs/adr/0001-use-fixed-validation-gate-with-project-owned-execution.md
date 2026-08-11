---
status: accepted
---

# Use a fixed Validation Gate with project-owned execution

But Why uses a fixed read-only Validation Gate instead of a generic pipeline language.
Repositories configure Checks and reviewers inside the fixed phases, but they do not define arbitrary phases or step types.
But Why owns command and reviewer execution contracts and uses project-owned native Git for disposable Snapshot Workspace creation and cleanup.

## Considered Options

- Build a generic validation pipeline and custom execution engine.
- Treat validation as one opaque repository command.
- Keep fixed domain phases with project-owned command and reviewer execution contracts.

## Consequences

But Why owns Validation Runs, phases, Findings, Artifacts, Reviewer Sessions, Snapshot Workspaces, execution diagnostics, and interruption behavior.
A Pi Reviewer Adapter launches each reviewer invocation through Effect command execution and preserves bounded same-session output correction.
Reviewer Sessions belong to one Change and persist independently from disposable Snapshot Workspaces so successor Candidates can reuse repository orientation.
Host interruption terminates the reviewer process tree before Snapshot Workspace cleanup begins.
Snapshot Workspace creation and cleanup use project-owned native Git and provide no reviewer behavior or security isolation.
