# Reconcile one owned PR once

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`

## Behaviors owned

- Source capability: by reconcile records core GitHub facts and projects waiting, ready, done, or code-owned remote blockers.
- Own GitHub-authoritative checks, non-draft state, mergeability, external head or base blockers, and unmerged closure.
- Requested-change review facts and their readiness projection belong to Task 104.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

by reconcile records core GitHub facts and projects waiting, ready, done, or code-owned remote blockers.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

One-shot fake GitHub CLI test.

## Acceptance criteria

- [ ] by reconcile records core GitHub facts and projects waiting, ready, done, or code-owned remote blockers.
- [ ] Own GitHub-authoritative checks, non-draft state, mergeability, external head or base blockers, and unmerged closure.
- [ ] Requested-change review facts are left to Task 104 without speculative handling.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/098-publish-one-exact-eligible-candidate.md`
