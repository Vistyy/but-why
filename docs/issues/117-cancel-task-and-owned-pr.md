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

Keep `by task cancel <task-id> --reason <reason>` for Task-backed Changes and add `by change cancel <change-id>` for taskless Changes, coordinating owned PR closure, durable terminal state, and safe cleanup.

## Primary verification seam

Task and Change cancellation CLI tests with a fake GitHub boundary and focused real-Git cleanup cases.

## Acceptance criteria

- [ ] Task cancellation requires a non-empty reason and an unfinished Task.
- [ ] `by change cancel` accepts only an open taskless Change.
- [ ] Direct Change cancellation of a Task-backed Change is rejected with the supported Task command.
- [ ] An owned open PR is closed before local cancellation commits.
- [ ] A GitHub closure failure leaves the lifecycle open and returns an actionable error.
- [ ] An observed merged PR completes the Change and linked Task instead of cancelling them.
- [ ] Cancellation permanently closes the applicable Change and Task while preserving history.
- [ ] Cancellation attempts the same safe cleanup policy used after merge.
- [ ] Unsafe cleanup leaves resources pending and reports the reason without reopening lifecycle state.
- [ ] Repeated cancellation returns the durable result unchanged.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/133-start-prepared-changes.md`
