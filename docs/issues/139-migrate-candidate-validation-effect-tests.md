# Migrate Candidate validation Effect tests

## Status

Done.

## Completion

- Implementation: `be3f39a0d242ce318ddd82b871c7188df5686570`
- Review corrections: `2b88f95bab2ad0fd1dee91b5fa7c47113dfa445f`

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/136-compose-candidate-validation-through-effect.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- Candidate validation test helpers expose Effect programs or Layers instead of executing an Effect runtime.
- Candidate validation, Task-backed Acceptance Review, and Check tests execute Candidate Effects through `@effect/vitest`.
- Validation Workspace lifecycle, Candidate Layer provisioning, and virtual time remain observable through framework-owned Effect execution.
- Existing Candidate validation outcomes, Findings, Tooling Failures, revision, cleanup, interruption, and timing assertions remain unchanged.

## What to build

Migrate the complete Candidate validation test suite to the shared Effect test execution convention.
Move Candidate validation helper composition and every helper consumer together so test-owned Layers and `@effect/vitest` own runtime execution.

## Primary verification seam

Candidate validation integration tests execute Prepare, Checks, Acceptance Review, and Specialists through `it.effect` or `it.scoped` with test-provided Layers and without a direct `Effect.run*` call in their helper.

## Acceptance criteria

- [x] Candidate validation test helpers expose Effect programs or Layers without direct `Effect.run*` calls.
- [x] Candidate validation, Task-backed Acceptance Review, and Check tests use `it.effect` or `it.scoped`.
- [x] Validation Workspace lifecycle tests execute through `it.scoped` and preserve cleanup and interruption assertions.
- [x] Candidate validation Layer tests provide dependencies through test Layers.
- [x] Virtual-time tests use `TestClock` rather than wall-clock waiting.
- [x] Existing Candidate validation outcomes, Findings, Tooling Failures, revision, cleanup, interruption, and timing assertions remain unchanged.

## Blocked by

None - can start immediately.
