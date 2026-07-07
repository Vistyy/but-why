---
status: accepted
---

# Use use-case modules over private SQLite stores

But Why uses command-facing use-case modules over private SQLite persistence.
The public architecture is not a generic RepoState and not direct store access from CLI handlers.
CLI handlers delegate to use-case modules such as `TaskUseCases` and submit preflight.
Those modules may compose the narrow persistence operations needed to preserve existing command behavior.

The former RepoState seam mixed Task, Run, submit, and validation persistence behind one broad interface.
That made it too easy for new code to depend on more durable state behavior than it needed.
The replacement keeps SQLite details private and names code after the command or workflow it supports.

TaskStore owns Task content, Task Context, comments, lifecycle transitions, and branch binding.
RunStore owns durable Run history and local execution records.
Use-case modules own command-shaped reads, such as task detail output that includes the latest Run ID.
That keeps `latestRun` out of TaskStore while preserving the existing CLI output.

A private SQLite layer owns shared connection handling and low-level SQL.
Shared transactions are allowed inside that SQLite implementation only.
They are not exposed as a generic transaction API.

ValidationRuns owns validation start coordination.
For local SQLite-backed Tasks, it atomically rechecks submit readiness, binds the Task branch when needed, creates the Run, and moves the Task to validating.
It also owns validation tooling failure recovery that records the Run tooling error and restores the Task to its prior submit-eligible state.
A validation tooling failure is not a Finding.
Submit keeps early read-only readiness checks for UX, but those checks are not authoritative.

SQLite query results use typed query helpers instead of scattered per-row `is*Row` guards.
The schema, selected column aliases, mapper types, and integration tests are the contract.
An ast-grep rule blocks reintroducing SQLite row guard sprawl.

## Considered Options

- Keep RepoState as the durable state interface.
- Make TaskStore and RunStore the public architecture.
- Use command-facing use-case modules over private SQLite stores.
- Add a generic database or transaction seam below both stores.

## Consequences

- CLI handlers call use-case modules instead of SQLite stores directly.
- TaskStore no longer exposes Run reads.
- RunStore no longer exposes submit-start behavior.
- SQLite remains the only storage implementation.
- The CLI keeps its existing output and persistence behavior.
- ValidationRuns is the only local validation-start write seam.
