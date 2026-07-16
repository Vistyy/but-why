# Cancel a Task and its owned PR

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Cancellation is one synchronous terminal operation for the manual v1 workflow.

## What to build

Add `by task cancel <task-id> --reason <reason>` across Task, Change, dependency, and owned PR facts.

## Primary verification seam

Cancellation CLI test with a fake GitHub boundary.

## Acceptance criteria

- [ ] Cancellation requires a non-empty reason and an unfinished Task.
- [ ] An owned open PR is closed before local cancellation commits.
- [ ] A GitHub closure failure leaves the Task open and returns an actionable error.
- [ ] An observed merged PR completes the Task instead of cancelling it.
- [ ] Cancellation permanently closes the Task and Change while preserving history.
- [ ] Cancelled Tasks do not satisfy dependencies and reject later Start or Submit.
- [ ] Repeated cancellation returns the durable result unchanged.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
