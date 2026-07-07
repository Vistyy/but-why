# Snapshot Task Context for Validation Runs

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Record the Task Context judged by a Validation Run.

A later change to Task title, description, comments, or external context should not make old validation history ambiguous.

This slice should make validation history able to identify the intent that was judged without changing current Task Context commands.

This should land before reviewer agents depend on mutable Task Context.

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
