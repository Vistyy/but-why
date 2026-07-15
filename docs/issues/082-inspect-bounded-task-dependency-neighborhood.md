# Inspect a bounded Task neighborhood

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Agents inspect one Task, its local dependency neighborhood, and its currently legal actions.
- Default output stays bounded while reporting complete totals and truncation.

## What to build

Expand Task detail with prerequisite and dependent summaries plus a compact `availableActions` collection.
Each action includes a complete command template with required placeholders.
Provide an explicit complete-graph escape hatch.

## Primary verification seam

Structured Task inspection test.

## Acceptance criteria

- [ ] Task detail shows current status, direct prerequisites, direct dependents, and their totals.
- [ ] Default traversal and content previews are bounded and disclose truncation.
- [ ] Complete graph inspection requires an explicit option.
- [ ] `availableActions` contains only legal state-changing operations for the current facts.
- [ ] Every available action includes a complete command template.
- [ ] Empty prerequisite, dependent, and action collections are definitive.

## Open decisions to grill

- Default depth, node cap, and content preview limit.
- Complete-graph syntax and exact TOON schema.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
