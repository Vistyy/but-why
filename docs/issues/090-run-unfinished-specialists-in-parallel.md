# Run unfinished Specialists in parallel

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Required unfinished Specialists run concurrently against one exact Candidate and policy.
- Each trustworthy result is retained independently.
- Tooling retries run only failed or missing Specialists.
- Fixing waits until the complete reviewer group has returned.

## What to build

Expand the single-Specialist runner into the shared parallel reviewer-group behavior, exercised first by Specialists.
Preserve deterministic inspection order without serializing execution.

## Primary verification seam

Multi-Specialist integration test with one controlled tooling failure.

## Acceptance criteria

- [ ] Every required Specialist without an eligible current result starts concurrently.
- [ ] Each trustworthy clean or Finding result is persisted with its own provenance as soon as it completes.
- [ ] A Specialist Finding does not cancel or delay sibling reviewers.
- [ ] A Specialist tooling failure leaves the group incomplete without invalidating trustworthy sibling results.
- [ ] A later Attempt runs only failed or missing Specialists for the same exact Candidate and policy.
- [ ] Changed Candidate or immutable policy invalidates incomplete-group reuse.
- [ ] Fixing does not start until every required Specialist has a trustworthy result.
- [ ] All collected Specialist Findings become one phase-local Fixer batch.
- [ ] Inspection presents configured deterministic Specialist order regardless of completion order.
- [ ] Hold and cancellation stop unfinished processes while preserving already trustworthy results.

## Open decisions to grill

- Parallelism limit within one reviewer group.
- Timeout handling and cancellation grace for unfinished reviewers.
- Exact partial-group progress and retry AXI schemas.

## Blocked by

- `docs/issues/089-run-one-configured-pi-specialist.md`
