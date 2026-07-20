# Migrate state stores to Effect programs

## Specification

- `docs/issues/137-move-state-storage-to-effect-sql.md`
- `spikes/effect-first-path/README.md`
- `docs/architecture.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`

## Behaviors owned

- Every surviving state store uses the shared scoped Effect SQL service.
- Store operations return Effect programs with typed storage failures.
- Store transactions preserve the current atomicity and rollback behavior.
- Public Task, Change, Candidate, and Validation Run behavior remains unchanged.
- The CLI composes storage programs without synchronously executing a store operation.

## What to build

Replace the temporary synchronous store contract with Effect-native store ports and adapters.

Compose one scoped `SqlClient` service for the repository state database.

Propagate the Effect store contract through Task, Change, Candidate, Validation Run, local use cases, inspection, submission, publication, reconciliation, and CLI routes.

Map SQL, migration, unavailable-state, identity, and persisted-JSON failures to precise repository storage errors.

Use Effect SQL transaction boundaries for operations that currently require atomic writes.

Keep the temporary compatibility implementation available only until Task 147 removes it.
Production callers must use the new Effect-native contract before Task 146 is complete.

## Primary verification seam

A cross-process CLI workflow initializes a repository, creates and persists a Task-backed Change, exits, and reads the same Change and Candidate state through a later process.

## Acceptance criteria

- [ ] Every surviving store obtains the shared `SqlClient` service through Effect composition.
- [ ] Store ports and adapters return Effect programs instead of synchronous database results.
- [ ] Storage failures use tagged Effect error channels for SQL, migration, unavailable-state, identity, and persisted-JSON failures.
- [ ] Domain rejection results remain the existing successful domain result unions.
- [ ] Candidate capture, Change completion, Task transitions, and Validation Run writes roll back on failure.
- [ ] Task CLI behavior remains unchanged for creation, listing, comments, dependencies, and lifecycle transitions.
- [ ] Change Start, Candidate capture, inspection, submission, publication, and reconciliation behavior remains unchanged.
- [ ] Validation Run findings, rounds, artifacts, and tooling failures remain unchanged.
- [ ] Existing concurrency, shared-state, linked-worktree, and persistence tests pass through Effect programs.
- [ ] No production caller synchronously invokes a store operation.
- [ ] Task 147 is the only remaining owner of removing the temporary compatibility implementation.

## Blocked by

- `docs/issues/137-move-state-storage-to-effect-sql.md`
