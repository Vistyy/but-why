# Teach the installed manual workflow

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`
- `docs/adr/0013-require-a-pr-or-verified-no-change-completion.md`
- `docs/public/skills/but-why/SKILL.md`

## Behaviors owned

- Source capability: The packaged skill teaches Task planning, manual validation, Submit, Needs Input, Hold, Resume, no-change completion, inspection, and cancellation.
- Own stable manual commands and AXI guidance, not Supervisor automation.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

The packaged skill teaches Task planning, manual validation, Submit, Needs Input, Hold, Resume, no-change completion, inspection, and cancellation.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Skill-content tests and reviewed examples.

## Acceptance criteria

- [ ] The packaged skill teaches Task planning, manual validation, Submit, Needs Input, Hold, Resume, no-change completion, inspection, and cancellation.
- [ ] Own stable manual commands and AXI guidance, not Supervisor automation.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/106-migrate-task-inspection.md`
- `docs/issues/114-show-change-activity.md`
- `docs/issues/115-show-execution-and-reviewer-usage.md`
- `docs/issues/119-close-owned-pr-after-cancellation.md`
- `docs/issues/128-hold-and-resume-task-progress.md`
- `docs/issues/129-complete-approved-task-with-no-change.md`
- `docs/issues/130-harden-automatic-code-writing-sandbox.md`
- `docs/issues/131-fix-owned-pr-merge-conflicts.md`
