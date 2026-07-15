# Manage the Task dependency graph

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- A dependency is a directed prerequisite that blocks only Task Start.
- Edges may change until the dependent Task starts and are fixed afterward.
- Duplicate changes are idempotent, while unknown Tasks, self-edges, and cycles are errors.
- Cancelled prerequisites remain unsatisfied.

## What to build

Add, remove, and inspect Task prerequisite edges through one atomic graph boundary.
Keep editing and Approval independent from dependency completion.

## Primary verification seam

Dependency CLI graph test.

## Acceptance criteria

- [ ] Adding and removing a valid edge updates both prerequisite and dependent inspection.
- [ ] Adding an existing edge and removing an absent edge are successful no-ops.
- [ ] Unknown Task IDs and self-edges are rejected without partial mutation.
- [ ] A cycle is rejected atomically and the error includes the complete cycle.
- [ ] An edge change is rejected after the dependent Task starts.
- [ ] A cancelled prerequisite remains present and unsatisfied until an unstarted dependent removes it.
- [ ] Dependency state does not block Task editing or Approval.

## Open decisions to grill

- Exact command names and AXI graph schema.
- Graph size and cycle-error limits.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
