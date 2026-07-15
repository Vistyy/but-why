# Teach AFK and Supervisor automation

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/public/skills/but-why/SKILL.md`

## Behaviors owned

- Source capability: The packaged skill adds worker setup, AFK queue, recovery, and health guidance.
- Own automation guidance only.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

The packaged skill adds worker setup, AFK queue, recovery, and health guidance.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Skill-content tests and reviewed automation example.

## Acceptance criteria

- [ ] The packaged skill adds worker setup, AFK queue, recovery, and health guidance.
- [ ] Own automation guidance only.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/111-wake-registered-repository-worker.md`
- `docs/issues/116-show-supervisor-worker-health.md`
- `docs/issues/123-teach-installed-manual-workflow.md`
