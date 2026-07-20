# Migrate lifecycle-sensitive Effect tests

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-establish-effect-test-execution.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- Effect-owned resource scopes run through `@effect/vitest`.
- Validation Workspace interruption and cleanup remain observable through Effect-owned test execution.
- Effect virtual time remains observable through `TestClock`.

## What to build

Migrate lifecycle-sensitive tests to `@effect/vitest`.
Cover Validation Workspace cleanup, interruption, Candidate validation Layer provisioning, and virtual time through the Effect test integration.

## Primary verification seam

Validation Workspace lifecycle tests execute through `it.scoped` and demonstrate cleanup after interruption.

## Acceptance criteria

- [ ] Lifecycle-sensitive tests use `it.scoped` or `it.effect`.
- [ ] Validation Workspace interruption and cleanup assertions remain unchanged.
- [ ] Candidate validation Layer tests provide their dependencies through test Layers.
- [ ] Virtual-time tests use `TestClock` rather than wall-clock waiting.

## Blocked by

- `docs/issues/139-establish-effect-test-execution.md`
