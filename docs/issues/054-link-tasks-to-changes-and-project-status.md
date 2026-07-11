# Link Tasks to Changes and project Task status

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Make Task Start and Task Resume operate through a linked Change while initial Task status becomes a projection of approval and implementation facts.
Task Context supplies immutable Acceptance Context without making Task the validation owner.
Later slices extend the projection when they add validation, Needs Input, publication, and reconciliation facts.

## Acceptance criteria

- [ ] Task Start creates the Task's sole Change and Change Workspace when absent or reuses them when open.
- [ ] Task Start uses the storage cardinality from Issue 050 and rejects a closed linked Change.
- [ ] Repeated Task Start does not create duplicate Changes, workspaces, or Implementer Executions.
- [ ] Task Start and Task Resume adopt immutable Acceptance Context from the current Task Context.
- [ ] Task Resume continues the same open Change with the newly adopted context and rejects a closed Change.
- [ ] Task status projects `new`, `todo`, and `implementing` from durable approval and linked Change facts.
- [ ] The projection has an explicit extension point for terminal `cancelled`.
- [ ] The projection has explicit extension points for validation, Needs Input, readiness, and merge facts.
- [ ] Validation storage no longer mutates Task status directly.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
