# Remove Task-owned implementation and delivery paths

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Change-owned implementation, validation, and delivery become the only supported path.

## What to build

Complete the Submit and inspection contract stages by deleting the remaining replaced Task-owned writers, readers, routes, compatibility branches, and obsolete tests after Change Submit and inspection migrate.

Task 107 does not alter `src/init/stateDatabase.ts` or historical schema migrations.
Task 137 owns the Effect SQL baseline and the removal of superseded Task-owned tables from the greenfield schema path.

## Primary verification seam

Full repository suite plus structural searches for removed Task-owned paths.

## Acceptance criteria

- [x] Change Start remains the only implementation-start path established by Task 133.
- [x] Top-level `by submit` is removed without a compatibility alias.
- [x] `by task findings` and `by task validation-runs` are removed without compatibility aliases.
- [x] Legacy Task-owned validation and delivery use cases and stores are removed.
- [x] Task 137 owns the historical migration chain and removal of superseded tables from the greenfield schema path.
- [x] No caller performs dual writes or fallback reads.
- [x] Removed every module and top-level folder that existed only for migration or forwarding.
- [x] Task commands own intent and Task lifecycle, while Change commands own implementation and delivery.
- [x] Current Change Submit, validation, publication, and inspection tests use only Change and Candidate ownership.
- [x] Architecture and configuration references describe the implemented v1.

## Completion evidence

- `just quality` passed with 351 tests passed and 1 skipped.
- Implementation commits: `16a6153`, `9e454b9`, `89f6090`, and `2bd8107`.

## Blocked by

- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/106-migrate-task-inspection.md`
- `docs/issues/133-start-prepared-changes.md`
