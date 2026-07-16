# Approve Task intent

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- New Tasks require permanent approval before they can start.
- Task Context remains editable before Start and becomes immutable afterward.

## What to build

Add the New state and an idempotent `by task approve <task-id>` operation without starting implementation or creating a Change.

## Primary verification seam

Task lifecycle CLI test in a temporary repository.

## Acceptance criteria

- [ ] Task creation records `new` rather than silently approving intent.
- [ ] Title, description, and comments may change while the Task is New.
- [ ] Approval atomically moves New to Todo and records durable approval.
- [ ] Repeated Approval is an unchanged success.
- [ ] Started and terminal Tasks reject Task Context edits and Approval with their legal actions.
- [ ] Structured output exposes approval and current state.

## Blocked by

None - can start immediately.
