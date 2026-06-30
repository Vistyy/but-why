# Start Tasks

## Parent

`docs/prd.md`

## What to build

Implement the explicit transition from `todo` to `implementing`.

This keeps task creation and implementation start as separate decisions.

This issue only records that implementation has begun.
It does not run, trigger, or orchestrate implementation work.

## Acceptance criteria

- [ ] `by task start <task-id>` moves a Task from `todo` to `implementing`.
- [ ] Starting an already implementing Task succeeds as a no-op.
- [ ] Starting a Task in `validating`, `needs_input`, `ready`, or `done` returns a structured `invalid_task_state` error.
- [ ] Invalid start errors include message `Cannot start task <task-id> from state <state>`.
- [ ] Invalid start errors include state-specific help: `validating` -> `Wait for validation to finish.`; `needs_input` -> `Address findings or add Task Context, then run by submit <task-id>.`; `ready` -> `Review and merge the pull request.`; `done` -> `Task is already done.`
- [ ] State changes are durable.
- [ ] `todo -> implementing` updates `updatedAt`.
- [ ] Already-`implementing` no-op success does not update `updatedAt`.
- [ ] CLI output includes the new state, whether the state changed, and next useful action.
- [ ] Starting from `todo` reports `changed: true`; starting from `implementing` reports `changed: false`.
- [ ] Successful output uses the next action: `Implement the task, then run by submit <task-id>`.
- [ ] Successful output uses this compact shape: `task.id`, `task.state`, `task.changed`, `task.updatedAt`, and `next`.
- [ ] Starting a `todo` Task moves it out of the default `by` dashboard because `implementing` is not an actionable dashboard state.

## Blocked by

- 007-deepen-task-architecture-seams.md
- 021-support-json-cli-output.md
