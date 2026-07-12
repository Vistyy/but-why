# Validate Candidate checks without a Task

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Move prepare and configured checks into a Candidate-owned validation path that does not require a Task or GitHub.
Keep this partial path behind the application boundary until the complete Validation Gate can be exposed as `by validate`.

## Acceptance criteria

- [ ] The Candidate validation use case works with a Candidate-owned Validation Run and without a Task or GitHub target.
- [ ] The use case accepts optional Acceptance Context without requiring a Task.
- [ ] Prepare and every configured check run against the exact Candidate in a read-only Validation Workspace.
- [ ] After each command, validation verifies that the Candidate commit, index, and tracked content remain unchanged; temporary environment files are allowed.
- [ ] A Prepare Finding ends the run before checks start.
- [ ] Every configured check runs after an earlier check Finding; validation stops only when a tooling failure makes later results unsafe.
- [ ] One attempt of the complete configured check set is one checks Round, with each check recorded as a Producer.
- [ ] A prepare or check command that returns non-zero or times out records a Finding; failure to start, observe, capture, record, or safely verify execution records a Validation Tooling Failure.
- [ ] Findings are immutable and recorded as open.
- [ ] Finding IDs keep the `<validation-run-id>-F<n>` format and allocate unique numbers safely in producer execution order.
- [ ] A checks Finding ends that Candidate's Validation Run; later fixing creates a successor Candidate and a new Validation Run.
- [ ] A Validation Tooling Failure ends the run; retrying the same Candidate creates a new run while preserving the failed run.
- [ ] Check Findings, tooling failures, rounds, and Artifacts remain durable and inspectable.
- [ ] Each completed producer result commits its Round outcome, Finding or tooling failure, and Artifact references atomically after Artifact content is stored.
- [ ] Partial check completion cannot be reported as complete validation or become eligible for publication.
- [ ] Validation never changes Task state or publishes a PR.
- [ ] Task-backed validation uses the same Candidate-owned path as standalone validation.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
- `docs/issues/051-add-automatic-change-and-candidate-capture.md`
- `docs/issues/053-freeze-policy-and-make-validation-idempotent.md`
