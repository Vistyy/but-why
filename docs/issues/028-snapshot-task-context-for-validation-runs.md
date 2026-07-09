# Snapshot Task Context for Validation Runs

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Record the Task Context judged by a Validation Run.

A later change to Task title, description, or comments should not make old validation history ambiguous.

This slice should make validation history able to identify the intent that was judged without changing current Task Context commands.

This should land before reviewer agents depend on mutable Task Context.

## Resolved design

- Each Validation Run owns an inline, immutable Task Context Snapshot.
- After creating the Validation Run with snapshot state `pending`, validation start reads the full Task Context as one consistent value and passes it to Validation Run storage.
- Validation Run storage saves the Task Context Snapshot as one versioned JSON value rather than separate fields.
- The first JSON shape uses `version: 1`.
- Each Validation Run stores its prior submit-eligible Task state and a snapshot state of `not_required`, `pending`, `saved`, or `failed`.
- Existing Validation Runs migrate to `not_required`, while new Validation Runs start with `pending`.
- Validation work starts only after the Task Context Snapshot reaches `saved`.
- Reading, building, encoding, or saving the snapshot records a `task_context_snapshot_failed` Validation Tooling Failure when the state database remains writable.
- Snapshot failure changes the snapshot state to `failed`, ends the Validation Run with `error`, and returns the Task to its prior submit-eligible state.
- A later submit recovers a `pending` run interrupted during snapshot creation by recording the tooling failure, ending the run with `error`, and restoring the Task state before allowing a fresh submit.
- Snapshot storage accepts the first save and an identical retry, but rejects replacement with different content.
- `by validation-run show` always includes top-level `taskContextSnapshot` with the v1 shape `{ version, title, description, comments }`.
- `taskContextSnapshot` is `null` when snapshot creation fails, and the Validation Tooling Failure explains the failure.
- Runs with snapshot state `not_required` also return `taskContextSnapshot: null` without inventing a snapshot or tooling failure.
- A state database failure that prevents failure recording is returned as the normal database error.

## Acceptance criteria

- [ ] A Validation Run records or references the Task Context used for validation.
- [ ] The snapshot includes the Task title, description, and Task comment content used by reviewers.
- [ ] Existing Task Context commands remain unchanged.
- [ ] Existing submit behavior remains unchanged except for durable snapshot recording.
- [ ] Run inspection can identify the Task Context snapshot or revision used by the Validation Run.
- [ ] Later Task comments do not change the stored context for an earlier Validation Run.
- [ ] Snapshot creation failure is recorded as a typed validation-start tooling error.
- [ ] Tests cover snapshot creation at validation start.
- [ ] Tests cover old snapshots remaining stable after Task Context changes.
- [ ] No reviewer agent behavior is added.

## Blocked by

- `docs/issues/013-inspect-runs-and-latest-task-findings.md`
- `docs/issues/027-represent-validation-run-separately-from-run.md`
