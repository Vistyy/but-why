# Expand Candidate-owned validation through Checks

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- One captured Candidate can run Prepare and every configured Check through Candidate-owned records.
- One Submit invocation has at most one Validation Run execution.
- Explicit local validation files remain simple environment inputs.

## What to build

Add the new Candidate-owned checks path beside the unchanged public Task submit path so later migration Tasks can adopt it without dual writes.

## Primary verification seam

Candidate validation integration test in a temporary repository.

## Acceptance criteria

- [ ] A clean committed head is captured or reused as an exact Candidate.
- [ ] One Candidate-owned Validation Run executes one fresh disposable Validation Workspace.
- [ ] Configured regular files are copied once from the Local Repository's main checkout without hashing, storage, race detection, or identity changes.
- [ ] Prepare failure stops Checks, while ordinary Check failures and timeouts do not stop later Checks.
- [ ] Workspace integrity protects the exact Candidate throughout validation.
- [ ] Findings, Tooling Failures, logs, and bounded Artifacts belong to the Candidate-owned Run.
- [ ] The Run ends as passed, blocked, or tooling failed without Execution Attempts or automatic retries.
- [ ] Identical passing Candidate and policy evidence may be reused.
- [ ] The existing public Task submit path remains green and unchanged.

## Blocked by

None - can start immediately.
