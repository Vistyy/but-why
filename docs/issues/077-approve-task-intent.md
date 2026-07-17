# Approve Task intent

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- New Tasks require permanent approval before they can start.
- Task Comments may be appended before Start and become immutable afterward.

## What to build

Add the New state and an idempotent `by task approve <task-id>` operation without starting implementation or creating a Change.
The persisted lifecycle state is the durable approval record because Approval is the only transition from New to Todo.
Task Comments are append-only in v1.

## Primary verification seam

Task lifecycle CLI test in a temporary repository.

## Acceptance criteria

- [ ] Task creation records `new` rather than silently approving intent.
- [ ] Comments may be appended while the Task is New or Todo.
- [ ] Approval atomically moves New to Todo and records durable approval.
- [ ] Repeated Approval is an unchanged success.
- [ ] Started and terminal Tasks reject Task Comment additions and Approval with their legal actions.
- [ ] Structured output exposes approval and current state.

## Blocked by

- Task 132: Add disposable Task Context drafts.
