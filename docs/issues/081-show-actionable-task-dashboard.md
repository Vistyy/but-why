# Show the actionable Task dashboard

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- The default home view shows Tasks on which a caller can act now.
- Actionable Tasks follow Task Queue Order.
- In-progress and dependency-blocked work remains visible through aggregate counts.
- Later Hold support expands the same projection with Held Tasks.

## What to build

Show New, eligible Todo, Needs Input, and Ready Tasks in one bounded actionable list.
Show definitive counts for implementing, validating, and dependency-blocked Tasks without placing them in that list.

## Primary verification seam

Top-level `by` dashboard test.

## Acceptance criteria

- [ ] New, eligible Todo, Needs Input, and Ready Tasks appear in Task Queue Order.
- [ ] Dependency-blocked Todo Tasks do not appear as startable.
- [ ] Implementing and validating Tasks do not appear as actionable.
- [ ] Aggregate counts account for hidden unfinished Tasks without double counting.
- [ ] Empty output states exactly what is empty and suggests only legal next commands.
- [ ] Output is bounded, reports shown and total counts, and exposes an explicit inspection command.

## Open decisions to grill

- Default limit, truncation, and exact TOON schema.
- Exact grouping and contextual command templates.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/080-order-and-reorder-tasks.md`
