# Run built-in Acceptance Review

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

- [ ] Acceptance starts only after Prepare and every Check pass.
- [ ] The reviewer receives the exact Candidate and immutable Acceptance Context.
- [ ] Instructions resolve Repo override, Global override, then built-in prompt.
- [ ] Profile selection resolves Repo selection, Global selection, then Global Default Agent Profile.
- [ ] Acceptance cannot be disabled.
- [ ] A trustworthy empty report passes the phase and any Finding blocks the Candidate.
- [ ] Structured-output exhaustion is a Validation Tooling Failure rather than a Finding.
- [ ] Acceptance Findings and reviewer evidence are durable on the Candidate-owned Run.

## Blocked by

- `docs/issues/083-start-task-in-managed-worktree.md`
- `docs/issues/084-expand-candidate-owned-validation-through-checks.md`
