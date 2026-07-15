# Deliver an implemented AFK Task

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Source capability: A worker reuses validation, fixing, and submit to deliver its Candidate to a PR or Needs Input.
- Own worker orchestration only, with no duplicate domain implementation.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

A worker reuses validation, fixing, and submit to deliver its Candidate to a PR or Needs Input.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Worker-to-PR end-to-end test.

## Acceptance criteria

- [ ] A worker reuses validation, fixing, and submit to deliver its Candidate to a PR or Needs Input.
- [ ] Own worker orchestration only, with no duplicate domain implementation.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/100-compose-standalone-validation-and-publication.md`
- `docs/issues/103-fix-failed-github-ci.md`
- `docs/issues/104-route-requested-pr-changes-to-needs-input.md`
- `docs/issues/131-fix-owned-pr-merge-conflicts.md`
- `docs/issues/108-implement-one-eligible-afk-task.md`
