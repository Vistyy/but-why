# Inspect a Candidate-owned Validation Run

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- A caller can inspect one Candidate-owned judgment and the evidence needed to act on it.

## What to build

Adapt Validation Run inspection to Candidate ownership without exposing standalone validation or Attempt machinery.

## Primary verification seam

`by validation-run show <validation-run-id>` integration test.

## Acceptance criteria

- [ ] Inspection identifies the Change, Candidate, comparison base, policy, state, and outcome.
- [ ] Phase results show Prepare, Checks, Findings, Tooling Failures, and Artifact references in stable order.
- [ ] Bounded content previews expose truncation and exact detail commands.
- [ ] Unknown Run, Artifact, and unavailable-content errors are typed and actionable.
- [ ] Structured output distinguishes empty collections from unavailable evidence.
- [ ] Inspection does not read Task-owned validation records.

## Blocked by

- `docs/issues/084-expand-candidate-owned-validation-through-checks.md`
