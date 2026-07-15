# Verify the v1 release surface

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/public/setup.md`
- `package.json`

## Behaviors owned

- Source capability: The installed npm package completes the supported manual and automated smoke flows.
- Own release-level smoke verification only and no new behavior.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

The installed npm package completes the supported manual and automated smoke flows.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Installed-package smoke suite.

## Acceptance criteria

- [ ] The installed npm package completes the supported manual and automated smoke flows.
- [ ] Own release-level smoke verification only and no new behavior.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/116-show-supervisor-worker-health.md`
- `docs/issues/119-close-owned-pr-after-cancellation.md`
- `docs/issues/122-compare-two-reviewer-suite-reports.md`
- `docs/issues/126-publish-but-why-to-npm.md`
