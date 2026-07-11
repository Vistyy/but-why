# Add Effect-scheduled GitHub polling

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Create shared GitHub polling mechanics for Change PR reconciliation using Effect scheduling.
The primitive owns polling, retry, timeout, and cancellation behavior while callers own PR state classification and Change transitions.

## Acceptance criteria

- [ ] GitHub polling uses `Effect.Schedule` or equivalent Effect scheduling.
- [ ] Poll intervals, retry limits, and timeout settings are validated before polling starts.
- [ ] Polling returns observed GitHub facts without deciding Change or Task state.
- [ ] Timeout, cancellation, authentication failure, remote failure, and malformed response remain distinct typed outcomes.
- [ ] Polling can be cancelled cleanly when a worker stops or a newer observation supersedes it.
- [ ] Repository workers can reuse the primitive without duplicating retry or timeout loops.
- [ ] Tests cover changed facts, unchanged facts, timeout, cancellation, transient failure, and terminal failure.

## Blocked by

None - can start immediately
