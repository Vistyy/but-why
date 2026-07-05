# Move validation start behind ValidationRuns

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Introduce a ValidationRuns domain seam for starting validation.

Submit code should ask to start validation instead of manually coordinating Task state, branch binding, Run creation, and Validation Run setup.

For local SQLite-backed Tasks, validation start should keep the existing atomic behavior.

The seam should not pretend that future remote Task authority can use the same local transaction semantics.

Remote rollback and recovery are out of scope.

This slice preserves current submit behavior while moving validation-start rules behind one domain operation.

## Acceptance criteria

- [ ] Submit code starts validation through a ValidationRuns seam.
- [ ] ValidationRuns.start owns Task state movement to validating for local Tasks.
- [ ] ValidationRuns.start owns Run creation for local validation.
- [ ] ValidationRuns.start owns first-submit branch binding where current behavior requires it.
- [ ] Local SQLite validation start remains atomic.
- [ ] Existing submit preflight behavior remains unchanged.
- [ ] Existing submit CLI output and structured errors remain unchanged.
- [ ] Remote rollback and recovery behavior is not implemented.
- [ ] Tests cover successful local validation start through the new seam.
- [ ] Tests cover existing preflight rejection behavior.
- [ ] Fallow boundary rules enforce that submit code reaches validation only through ValidationRuns, with no direct validation-start orchestration outside that seam.

## Blocked by

- `docs/issues/025-split-taskstore-from-runstore-with-sqlite.md`
