# Approve Task intent

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- New Tasks require permanent approval before they can start.
- Task Comments remain editable before Start and become immutable afterward.

## What to build

Add the New state and an idempotent `by task approve <task-id>` operation without starting implementation or creating a Change.

## Primary verification seam

Task lifecycle CLI test in a temporary repository.

## Acceptance criteria

- [ ] Task creation records `new` rather than silently approving intent.
- [ ] Comments may change before the Task starts.
- [ ] Approval atomically moves New to Todo and records durable approval.
- [ ] Repeated Approval is an unchanged success.
- [ ] Started and terminal Tasks reject Task Comment edits and Approval with their legal actions.
- [ ] Structured output exposes approval and current state.

## Blocked by

- Task 132: Add disposable Task Context drafts.
