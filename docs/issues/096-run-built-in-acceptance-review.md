# Run built-in Acceptance Review

## Status

Done.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- Acceptance Review judges the exact Candidate against immutable Task intent.
- Acceptance is always enabled and is the only reviewer that receives Acceptance Context.

## What to build

Add the built-in Pi Acceptance Reviewer after passing Checks with global and repository override resolution.

## Primary verification seam

Task-backed Candidate review test with a fake Pi runtime.

## Acceptance criteria

- [x] Acceptance starts only after Prepare and every Check pass.
- [x] The reviewer receives the exact Candidate and immutable Acceptance Context.
- [x] Instructions resolve Repo override, Global override, then built-in prompt.
- [x] Profile selection resolves Repo selection, Global selection, then Global Default Agent Profile.
- [x] Acceptance cannot be disabled.
- [x] A trustworthy empty report passes the phase and any Finding blocks the Candidate.
- [x] Structured-output exhaustion is a Validation Tooling Failure rather than a Finding.
- [x] Acceptance Findings and reviewer evidence are durable on the Candidate-owned Run.

## Completion

Implemented in `8c2b58e`; review corrections completed through `e0cf0d1`.
Spec review: Approved with required comments; all comments resolved.
Standards review: Approved.
Quality: Passed - formatting, lint, architecture checks, typecheck, 331 tests, and Fallow checks.

## Blocked by

- `docs/issues/083-start-task-in-managed-worktree.md`
- `docs/issues/084-expand-candidate-owned-validation-through-checks.md`
