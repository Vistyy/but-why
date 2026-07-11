# Validate Candidate checks without a Task

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Move prepare and configured checks into a Candidate-owned validation path that does not require a Task or GitHub.
Keep this partial path behind the application boundary until the complete Validation Gate can be exposed as `by validate`.

## Acceptance criteria

- [ ] The Candidate validation use case works without a Task or GitHub target.
- [ ] The Validation Run belongs to the Candidate and accepts optional Acceptance Context.
- [ ] Prepare and every configured check run against the exact Candidate in a read-only Validation Workspace.
- [ ] Findings are immutable and remain open until a later eligible result links their resolution.
- [ ] Check Findings, tooling failures, rounds, resolution links, and Artifacts remain durable and inspectable.
- [ ] Partial check completion cannot be reported as complete validation or become eligible for publication.
- [ ] Validation never changes Task state or publishes a PR.
- [ ] The existing Task-backed path remains green during migration.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
- `docs/issues/051-capture-and-inspect-standalone-change.md`
