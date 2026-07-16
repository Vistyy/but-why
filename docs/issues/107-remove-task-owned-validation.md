# Remove Task-owned validation and delivery

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Candidate-owned validation and delivery become the only implementation path.

## What to build

Complete the expand-migrate-contract sequence by deleting every replaced Task-owned writer, reader, route, table, compatibility branch, and obsolete test.

## Primary verification seam

Full repository suite plus structural searches for removed Task-owned paths.

## Acceptance criteria

- [ ] Legacy Task-owned validation and delivery use cases and stores are removed.
- [ ] Superseded routes and compatibility branches are removed.
- [ ] Obsolete tables and migrations are contracted through the supported greenfield schema path.
- [ ] No caller performs dual writes or fallback reads.
- [ ] Current Task, Submit, validation, publication, and inspection tests use only Change and Candidate ownership.
- [ ] Architecture and internal configuration references describe the implemented reduced v1.

## Blocked by

- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/106-migrate-task-inspection.md`
