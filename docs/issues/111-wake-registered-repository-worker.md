# Wake a registered repository worker

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0010-keep-the-supervisor-infrastructure-only.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Source capability: A durable coalesced wake launches at most one worker for its repository.
- Own wake queue, versioned child protocol, one worker slot per repository, and cross-repository parallelism.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

A durable coalesced wake launches at most one worker for its repository.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Supervisor-worker protocol test.

## Acceptance criteria

- [ ] A durable coalesced wake launches at most one worker for its repository.
- [ ] Own wake queue, versioned child protocol, one worker slot per repository, and cross-repository parallelism.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/110-register-repository-with-linux-supervisor.md`
