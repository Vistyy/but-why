# Migrate Task inspection

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Source capability: Task views summarize linked Change facts and stop reading Task-owned validation.
- Own reader migration only and reuse Candidate history and PR facts.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

Task views summarize linked Change facts and stop reading Task-owned validation.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Task and Change inspection tests.

## Acceptance criteria

- [ ] Task views summarize linked Change facts and stop reading Task-owned validation.
- [ ] Own reader migration only and reuse Candidate history and PR facts.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/088-list-bounded-candidate-validation-history.md`
- `docs/issues/101-reconcile-one-owned-pr-once.md`
- `docs/issues/105-migrate-task-backed-submission.md`
