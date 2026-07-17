# Approve Task intent

## Status

Done.

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

- [x] Task creation records `new` rather than silently approving intent.
- [x] Comments may be appended while the Task is New or Todo.
- [x] Approval atomically moves New to Todo and records durable approval.
- [x] Repeated Approval is an unchanged success.
- [x] Started and terminal Tasks reject Task Comment additions and Approval with their legal actions.
- [x] Structured output exposes approval and current state.

## Completion

Implemented in `2c5e93b`.
Spec review: Approved.
Standards review: Approved.
Quality: Passed - 272 tests.

## Blocked by

None - can start immediately.
