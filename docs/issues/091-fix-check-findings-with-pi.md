# Fix check Findings with Pi

> Draft task boundary approved through the vertical-slice audit.
> Grill this draft before implementation to resolve its exact interface, errors, limits, and edge cases.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Source capability: An enabled validation Fixer commits a successor Candidate and validation resumes.
- Own validation Fixer policy, Code-Writing Execution, Implementation Decisions, clean successor Candidate, budget, and code-detected no-successor Needs Input.
- This task owns only the behavior demonstrated through its primary verification seam.

## What to build

An enabled validation Fixer commits a successor Candidate and validation resumes.
Implement the complete path through every required layer while keeping behavior assigned to later tasks outside this task.
The repository must remain green when this task completes.

## Primary verification seam

Fake Pi check-fixing test.

## Acceptance criteria

- [ ] An enabled validation Fixer commits a successor Candidate and validation resumes.
- [ ] The Fixer makes its best available decisions, records consequential Implementation Decisions, and attempts the complete Check Finding batch without requesting Needs Input.
- [ ] But Why? verifies the resulting commit and Candidate independently of the agent claim.
- [ ] A completed execution without a clean successor Candidate becomes a code-owned Needs Input reason after approved recovery is exhausted.
- [ ] The primary verification seam demonstrates the capability through caller-visible behavior.
- [ ] Errors are typed, actionable, non-interactive, and preserve durable state on failure.
- [ ] Existing supported behavior remains green unless this task explicitly replaces it.
- [ ] No behavior owned by a dependent task is implemented speculatively.

## Open decisions to grill

- Exact interface and AXI output contract.
- Failure, cancellation, retry, and idempotency details that apply to this capability.
- Limits and edge cases required for implementation-ready acceptance criteria.

## Blocked by

- `docs/issues/085-recover-interrupted-standalone-validation.md`
- `docs/issues/086-validate-with-allowlisted-local-files.md`
