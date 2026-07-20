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

- [ ] Task cancellation requires a non-empty reason and an unfinished Task.
- [ ] `by change cancel` accepts only an open taskless Change.
- [ ] Direct Change cancellation of a Task-backed Change is rejected with the supported Task command.
- [ ] Cancellation closes an owned open PR before it records local cancellation.
- [ ] A GitHub closure failure leaves the lifecycle open and returns an actionable error.
- [ ] An observed merged PR completes the Change and linked Task instead of cancelling them.
- [ ] Cancellation permanently closes the applicable Change and Task while preserving history.
- [ ] Cancellation applies the cleanup policy for merged Changes.
- [ ] If cleanup is unsafe, resources remain pending and the command reports the reason.
- [ ] Pending cleanup does not reopen the Change lifecycle.
- [ ] Repeated cancellation returns the durable result unchanged.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/133-start-prepared-changes.md`
