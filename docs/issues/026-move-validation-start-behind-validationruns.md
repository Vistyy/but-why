# Move validation start behind ValidationRuns

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Introduce a ValidationRuns domain seam for starting validation.

This must replace and completely remove the temporary cross-store submit-start helper allowed by `docs/issues/025-split-taskstore-from-runstore-with-sqlite.md`.

It must also remove the temporary Fallow exception that allowed that helper to import both TaskStore and RunStore.

Submit code should ask to start validation instead of manually coordinating Task state, branch binding, Run creation, and Validation Run setup.

For local SQLite-backed Tasks, validation start should keep the existing atomic behavior.

The seam should not pretend that future remote Task authority can use the same local transaction semantics.

Remote rollback and recovery are out of scope.

This slice preserves current submit behavior while moving validation-start rules behind one domain operation.

Tests that covered the temporary helper in issue 025 should move to `ValidationRuns.start` or be deleted if they become redundant.

## Acceptance criteria

- [ ] Submit code starts validation through a ValidationRuns seam.
- [ ] The temporary cross-store submit-start helper from issue 025 is removed completely.
- [ ] The temporary Fallow exception for that helper is removed completely.
- [ ] ValidationRuns.start owns Task state movement to validating for local Tasks.
- [ ] ValidationRuns.start owns Run creation for local validation.
- [ ] ValidationRuns.start owns first-submit branch binding where current behavior requires it.
- [ ] Local SQLite validation start remains atomic.
- [ ] Existing submit preflight behavior remains unchanged.
- [ ] Existing submit CLI output and structured errors remain unchanged.
- [ ] Remote rollback and recovery behavior is not implemented.
- [ ] Tests cover successful local validation start through the new seam.
- [ ] Tests cover existing preflight rejection behavior.
- [ ] Temporary-helper tests from issue 025 are moved to `ValidationRuns.start` or deleted if redundant.
- [ ] Fallow boundary rules enforce that submit code reaches validation only through ValidationRuns, with no direct validation-start orchestration outside that seam.

## Blocked by

- `docs/issues/034-split-task-cli-edge-modules.md`
