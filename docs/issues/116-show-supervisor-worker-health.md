# Show Supervisor worker health

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0010-keep-the-supervisor-infrastructure-only.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Source capability: A caller sees registered repositories, worker state, failures, and pending wakes.
- Own bounded global health output without reading repository workflow state.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

A caller sees registered repositories, worker state, failures, and pending wakes.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Supervisor health CLI test.

## Acceptance criteria

- [ ] A caller sees registered repositories, worker state, failures, and pending wakes.
- [ ] Own bounded global health output without reading repository workflow state.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/113-isolate-unhealthy-repositories.md`
