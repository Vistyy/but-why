# Manage the AFK Task tag

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- V1 recognizes only the built-in `afk` tag.
- The tag controls automatic pickup without changing Task state.
- Tag changes are idempotent before Task Start and read-only afterward.

## What to build

Add and remove the `afk` tag through the Task module and CLI.
Reject unknown tags and changes after Task Start while leaving Task state unchanged.

## Primary verification seam

Task tag CLI test.

## Acceptance criteria

- [ ] Adding `afk` before Start persists it without changing Task state.
- [ ] Removing `afk` before Start persists its absence without changing Task state.
- [ ] Adding an existing tag and removing an absent tag are successful no-ops.
- [ ] Unknown tag names return a typed usage error without mutation.
- [ ] Tag mutation on a started or terminal Task is rejected with its legal current actions.
- [ ] A successful mutation commits before any Supervisor wake is emitted.

## Open decisions to grill

- Exact add, remove, list, and AXI output shapes.
- Whether creation and Approval accept `afk` as a convenience option.

## Blocked by

None - can start immediately.
