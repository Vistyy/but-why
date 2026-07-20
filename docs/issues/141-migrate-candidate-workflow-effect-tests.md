# Migrate Candidate workflow Effect tests

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-establish-effect-test-execution.md`
- `docs/issues/136-compose-candidate-validation-through-effect.md`

## Behaviors owned

- Candidate validation workflow tests execute Candidate Effects through `@effect/vitest`.
- Task-backed Acceptance Review tests execute through the same convention.
- Check phase tests preserve their current successful, Finding, and Tooling Failure assertions.

## What to build

Migrate Candidate validation, Task-backed Acceptance Review, and Check phase tests to the shared Effect test execution convention.
Do not change Candidate validation behavior or its public workflow seams.

## Primary verification seam

Candidate validation integration tests execute Prepare, Checks, Acceptance Review, and Specialists through `@effect/vitest`.

## Acceptance criteria

- [ ] Candidate validation integration tests use `it.effect` or `it.scoped`.
- [ ] Task-backed Acceptance Review tests use `@effect/vitest`.
- [ ] Check phase tests use `@effect/vitest`.
- [ ] Existing Candidate validation outcomes, Findings, Tooling Failures, and revision assertions remain unchanged.

## Blocked by

- `docs/issues/139-establish-effect-test-execution.md`
