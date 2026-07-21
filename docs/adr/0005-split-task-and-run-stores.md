---
status: accepted
---

# Use use-case modules over private SQLite stores

ADR 0014 supersedes this ADR's ownership statements for Validation Run history and validation-start coordination.
The remaining decisions in this ADR stay accepted.

But Why uses command-facing use-case modules over private SQLite persistence.
The public architecture is not a generic RepoState and not direct store access from CLI handlers.
CLI handlers delegate to use-case modules such as `TaskUseCases` and submit preflight.
Those modules may compose the narrow persistence operations needed to preserve existing command behavior.

The former RepoState seam mixed Task, Validation Run, submit, and validation persistence behind one broad interface.
That made it too easy for new code to depend on more durable state behavior than it needed.
The replacement keeps SQLite details private and names code after the command or workflow it supports.

TaskStore owns Task content, Task Context, comments, lifecycle transitions, and branch binding.
Change-owned persistence interfaces own durable Validation Run history and local execution records.
Use-case modules own command-shaped reads, such as task detail output that includes the latest Validation Run ID.
That keeps latest Validation Run reads out of TaskStore while preserving command-shaped output.

A private SQLite layer owns shared connection handling and low-level SQL.
Shared transactions are allowed inside that SQLite implementation only.
They are not exposed as a generic transaction API.
Concrete SQLite stores are wired through a local repo storage seam, not from command-facing use cases.

A Change-owned operation coordinates validation start.
For local SQLite-backed Tasks, the operation atomically rechecks submit readiness, binds the Task branch when needed, creates the Validation Run, and moves the Task to validating.
The Change-owned operation also records Validation Tooling Failures and restores the Task to its prior submit-eligible state.
A validation tooling failure is not a Finding.
Submit keeps early read-only readiness checks for UX, but those checks are not authoritative.

SQLite query results use typed query helpers instead of scattered per-row `is*Row` guards.
The schema, selected column aliases, mapper types, and integration tests are the contract.
An ast-grep rule blocks reintroducing SQLite row guard sprawl.

## Considered Options

- Keep RepoState as the durable state interface.
- Make TaskStore and Validation Run storage the public architecture.
- Use command-facing use-case modules over private SQLite stores.
- Add a generic database or transaction seam below both stores.

## Consequences

- CLI handlers call use-case modules instead of SQLite stores directly.
- TaskStore no longer exposes Validation Run reads.
- Validation Run storage no longer exposes submit-start behavior.
- SQLite remains the only storage implementation.
- CLI output is command-shaped and may use current domain names instead of preserving old persistence names.
- A Change-owned operation is the only local validation-start write seam.
