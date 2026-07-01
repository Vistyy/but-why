# Start Tasks

## Status

Done.

## Parent

`docs/prd.md`

## What to build

Implement the explicit transition from `todo` to `implementing`.

This keeps task creation and implementation start as separate decisions.

This issue only records that implementation has begun.
It does not run, trigger, or orchestrate implementation work.

## Resolved design notes

- Add `startTask(taskId, now)` as the Task-module lifecycle operation.
- Keep the generic durable state transition underneath `startTask` as storage-level plumbing.
- Do not let storage-level `invalid_task_state_transition` leak into CLI output.
- Use `invalid_task_state` as the public error when an existing Task cannot be started from its current state.
- Keep the successful output shape exactly as specified below, including `task.changed`.
- Treat `next` as command guidance, not persistent Task data.
- Do not add `startedAt`, `startedBy`, or a separate started flag.
- Keep dashboard actionability derived from Task state only.
- Test lifecycle policy at the Task module layer and structured TOON and JSON output at the CLI layer.
- Do not create an ADR for this issue.

## Acceptance criteria

- [x] `by task start <task-id>` moves a Task from `todo` to `implementing`.
- [x] Starting an already implementing Task succeeds as a no-op.
- [x] Starting a Task in `validating`, `needs_input`, `ready`, or `done` returns a structured `invalid_task_state` error.
- [x] Invalid start errors include message `Cannot start task <task-id> from state <state>`.
- [x] Invalid start errors include state-specific help: `validating` -> `Wait for validation to finish.`; `needs_input` -> `Address findings or add Task Context, then run by submit <task-id>.`; `ready` -> `Review and merge the pull request.`; `done` -> `Task is already done.`
- [x] State changes are durable.
- [x] `todo -> implementing` updates `updatedAt`.
- [x] Already-`implementing` no-op success does not update `updatedAt`.
- [x] CLI output includes the new state, whether the state changed, and next useful action.
- [x] Starting from `todo` reports `changed: true`; starting from `implementing` reports `changed: false`.
- [x] Successful output uses the next action: `Implement the task, then run by submit <task-id>`.
- [x] Successful output uses this compact shape: `task.id`, `task.state`, `task.changed`, `task.updatedAt`, and `next`.
- [x] Starting a `todo` Task moves it out of the default `by` dashboard because `implementing` is not an actionable dashboard state.

## Blocked by

- 007-deepen-task-architecture-seams.md
- 021-support-json-cli-output.md
