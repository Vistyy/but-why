# Move validation start behind ValidationRuns

## Status

Done.

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

Resolved design decisions:

- Submit preflight may keep early read-only readiness checks for UX and unchanged structured errors.
- Early readiness checks are not authoritative validation-start eligibility.
- `ValidationRuns.start` is the only operation that turns a preflight-approved candidate into an active Validation Run.
- `ValidationRuns.start` must revalidate submit readiness atomically before mutating state.
- For local Tasks, `ValidationRuns.start` owns Task state movement, branch binding, active-run checks, Run creation, and Validation Run setup.
- Validation tooling failure recovery state changes belong behind the ValidationRuns seam, separate from `ValidationRuns.start`.
- Local SQLite atomicity stays private to the SQLite-backed ValidationRuns implementation.
- The seam exposes no public transaction API and no replacement cross-store helper.
- This slice supports local validation start only.
- Remote-backed Task Authority start, rollback, and recovery are not implemented in this slice.
- Non-local Task Authority validation start should fail with a structured unsupported error instead of pretending local transaction semantics apply.
- Fallow should enforce that submit reaches validation-start and validation recovery state changes only through the ValidationRuns seam.
- Submit should not import SQLite submit-start code, TaskStore and RunStore coordination code, or lower validation-start helpers.
- The canonical seam name is `ValidationRuns`.
- For this slice, the ValidationRuns seam exposes `start(input)` and `recordToolingFailure(input)`.
- `start(input)` receives candidate facts from submit, such as task id, branch, submitted commit SHA, and currently needed validated target facts.
- `start(input)` does not receive state-transition instructions or a prebuilt Run.
- `ValidationRuns.start` preserves the current submit-style domain error meanings.
- Submit CLI remains responsible for mapping those errors to CLI output.
- This slice does not introduce a new global domain error system.

Tests should target the ValidationRuns seam instead of SQLite helper internals.

Test coverage should include:

- Successful local validation start creates a Validation Run atomically.
- Task state moves to validating.
- First-submit branch binding works.
- Active run, wrong branch, and bad task state reject correctly.
- Submit CLI output stays unchanged.

Tests that covered the temporary helper in issue 025 should move to `ValidationRuns.start` or be deleted if they become redundant.

## Acceptance criteria

- [x] Submit code starts validation through a ValidationRuns seam.
- [x] The temporary cross-store submit-start helper from issue 025 is removed completely.
- [x] The temporary Fallow exception for that helper is removed completely.
- [x] ValidationRuns.start owns Task state movement to validating for local Tasks.
- [x] ValidationRuns.start owns Run creation for local validation.
- [x] ValidationRuns.start owns first-submit branch binding where current behavior requires it.
- [x] Local SQLite validation start remains atomic.
- [x] Existing submit preflight behavior remains unchanged.
- [x] Existing submit CLI output and structured errors remain unchanged.
- [x] Remote rollback and recovery behavior is not implemented.
- [x] Tests cover successful local validation start through the new seam.
- [x] Tests cover existing preflight rejection behavior.
- [x] Temporary-helper tests from issue 025 are moved to `ValidationRuns.start` or deleted if redundant.
- [x] Fallow boundary rules enforce that submit code reaches validation only through ValidationRuns, with no direct validation-start orchestration outside that seam.

## Blocked by

- `docs/issues/034-split-task-cli-edge-modules.md`
