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

- [ ] Change Start remains the only implementation-start path established by Task 133.
- [ ] Top-level `by submit` is removed without a compatibility alias.
- [ ] `by task findings` and `by task validation-runs` are removed without compatibility aliases.
- [ ] Legacy Task-owned validation and delivery use cases and stores are removed.
- [ ] Task 137 replaces the historical migration chain and removes superseded tables from the greenfield schema path.
- [ ] No caller performs dual writes or fallback reads.
- [ ] Remove every module and top-level folder that exists only for migration or forwarding.
- [ ] Task commands own intent and Task lifecycle, while Change commands own implementation and delivery.
- [ ] Current Change Submit, validation, publication, and inspection tests use only Change and Candidate ownership.
- [ ] Architecture and configuration references describe the implemented v1.

## Blocked by

- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/106-migrate-task-inspection.md`
- `docs/issues/133-start-prepared-changes.md`
