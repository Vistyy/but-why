# Close an owned PR after cancellation

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Cancellation closes the Change's owned PR without reopening local workflow.
- A lost response or temporary failure becomes durable cleanup work rather than a second close or republish attempt.

## What to build

Close an owned PR after durable Task cancellation and reconcile ambiguous responses through the existing PR identity.

## Primary verification seam

Fake GitHub cancellation test.

## Acceptance criteria

- [ ] Cancellation requests closure of the one durably owned PR.
- [ ] A confirmed close records the final remote fact without changing Cancelled state.
- [ ] A lost response is recovered by reading that same PR before another mutation.
- [ ] Temporary failure records pending cleanup for bounded retry.
- [ ] Permanent failure remains inspectable and never allows publication again.
- [ ] No PR is created, replaced, or adopted during cleanup.

## Open decisions to grill

- Retry schedule and permanent-failure threshold.
- Exact remote cleanup status in Task and Change inspection.

## Blocked by

- `docs/issues/099-recover-ambiguous-publication-result.md`
- `docs/issues/101-reconcile-one-owned-pr-once.md`
- `docs/issues/117-cancel-task-and-linked-change-durably.md`
