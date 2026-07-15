# Order and reorder Tasks

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Every unfinished Task occupies one explicit Task Queue Order position.
- New, blocked, active, and Held Tasks share that order.
- Done and Cancelled Tasks leave it.

## What to build

Persist one repository-wide order and support atomic moves to first, before, after, or last.
All actionable views and AFK pickup must filter this order rather than invent another priority.

## Primary verification seam

Task reorder CLI test.

## Acceptance criteria

- [ ] A new Task appends to the order atomically with creation.
- [ ] First, before, after, and last moves produce one gap-free order.
- [ ] Moving a Task to its current position is a successful no-op.
- [ ] Held, blocked, implementing, and validating Tasks keep their position.
- [ ] Done and Cancelled Tasks leave the unfinished order.
- [ ] Concurrent moves serialize without duplicate or missing positions.

## Open decisions to grill

- Exact reorder syntax and AXI response.
- Bounded list output and full-order escape hatch.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
