# Evaluate one Specialist fixture

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Source capability: A maintainer evaluates one configured Specialist against one pinned fixture.
- Own fixture format, fake-response software tests, real-run evidence, grader score, and retained output.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

A maintainer evaluates one configured Specialist against one pinned fixture.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Single-fixture evaluation seam.

## Acceptance criteria

- [ ] A maintainer evaluates one configured Specialist against one pinned fixture.
- [ ] Own fixture format, fake-response software tests, real-run evidence, grader score, and retained output.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/089-run-one-configured-pi-specialist.md`
