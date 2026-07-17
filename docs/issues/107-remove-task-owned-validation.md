# Remove Task-owned implementation and delivery paths

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Change-owned implementation, validation, and delivery become the only supported path.

## What to build

Complete the Submit and inspection contract stages by deleting the remaining replaced Task-owned writers, readers, routes, tables, compatibility branches, and obsolete tests after Change Submit and inspection migrate.

## Primary verification seam

Full repository suite plus structural searches for removed Task-owned paths.

## Acceptance criteria

- [ ] Change Start remains the only implementation-start path established by Task 133.
- [ ] Top-level `by submit` is removed without a compatibility alias.
- [ ] `by task findings` and `by task validation-runs` are removed without compatibility aliases.
- [ ] Legacy Task-owned validation and delivery use cases and stores are removed.
- [ ] Superseded tables and migrations are contracted through the supported greenfield schema path.
- [ ] No caller performs dual writes or fallback reads.
- [ ] Task commands own intent and Task lifecycle, while Change commands own implementation and delivery.
- [ ] Current Change Submit, validation, publication, and inspection tests use only Change and Candidate ownership.
- [ ] Architecture and configuration references describe the implemented v1.

## Blocked by

- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/106-migrate-task-inspection.md`
- `docs/issues/133-start-prepared-changes.md`
