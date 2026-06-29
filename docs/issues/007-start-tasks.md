# Start Tasks

## Parent

`docs/prd.md`

## What to build

Implement the explicit transition from `todo` to `implementing`.

This keeps task creation and implementation start as separate decisions.

## Acceptance criteria

- [ ] `by task start <task-id>` moves a Task from `todo` to `implementing`.
- [ ] Starting an already implementing Task succeeds as a no-op.
- [ ] Starting a Task in `validating`, `needs_input`, `ready`, or `done` returns a structured error.
- [ ] State changes are durable.
- [ ] CLI output includes the new state and next useful action.

## Blocked by

- 004-create-and-list-tasks.md
