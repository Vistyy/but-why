# Publish one exact eligible Candidate

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`

## Behaviors owned

- Source capability: by submit creates or updates one non-draft PR for an already-passed Candidate.
- Own Pi PR Writer, exact-head check, durable PR identity, and duplicate prevention.
- But Why? code records Needs Input when remote ambiguity remains after publication recovery.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

by submit creates or updates one non-draft PR for an already-passed Candidate.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Fake GitHub exact-head test.

## Acceptance criteria

- [ ] by submit creates or updates one non-draft PR for an already-passed Candidate.
- [ ] Own Pi PR Writer, exact-head check, durable PR identity, and duplicate prevention.
- [ ] But Why? code records Needs Input when remote ambiguity remains after publication recovery.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/095-complete-final-review.md`
