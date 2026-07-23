# Cancel Task-backed and taskless Changes

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Task-backed and taskless cancellation close Change lifecycle consistently.
- Both cancellation paths use the same safe cleanup policy.

## What to build

Keep `by task cancel <task-id> --reason <reason>` for Task-backed Changes.
Add `by change cancel <change-id>` for taskless Changes.
Both commands must coordinate owned PR closure, terminal state, and safe cleanup.

## Primary verification seam

Task and Change cancellation CLI tests with a fake GitHub boundary and focused real-Git cleanup cases.

## Acceptance criteria

- [x] Task cancellation requires a non-empty reason and an unfinished Task.
- [x] `by change cancel` accepts only an open taskless Change.
- [x] Direct Change cancellation of a Task-backed Change is rejected with the supported Task command.
- [x] Cancellation closes an owned open PR before it records local cancellation.
- [x] A GitHub closure failure leaves the lifecycle open and returns an actionable error.
- [x] An observed merged PR completes the Change and linked Task instead of cancelling them.
- [x] Cancellation permanently closes the applicable Change and Task while preserving history.
- [x] Cancellation applies the cleanup policy for merged Changes.
- [x] If cleanup is unsafe, resources remain pending and the command reports the reason.
- [x] Pending cleanup does not reopen the Change lifecycle.
- [x] Repeated cancellation returns the durable result unchanged.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/133-start-prepared-changes.md`

## Completion

Implemented in `28d3f00`, `bb26d72`, and `b787f57`.
Verified with focused cancellation and GitHub gateway tests, `just docs-check`, `just quality`, and `git diff --check`.
Spec review: approved.
Standards review: approved with required comments, with all comments resolved and the axis latched.
