# Produce a versioned release candidate

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/public/setup.md`
- `package.json`

## Behaviors owned

- Source capability: A versioned tarball installs in a clean repository and by --version matches it.
- Own version semantics and publishable metadata.
- Trusted publishing is owned later.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

A versioned tarball installs in a clean repository and by --version matches it.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Packed-package installation test.

## Acceptance criteria

- [ ] A versioned tarball installs in a clean repository and by --version matches it.
- [ ] Own version semantics and publishable metadata.
- [ ] Trusted publishing is owned later.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/123-teach-installed-manual-workflow.md`
- `docs/issues/124-teach-afk-and-supervisor-automation.md`
