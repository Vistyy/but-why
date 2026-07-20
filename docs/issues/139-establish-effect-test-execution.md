# Establish Effect test execution

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/136-compose-candidate-validation-through-effect.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- Every test helper that prepares an Effect value exposes an Effect or Layer instead of executing an Effect runtime.
- `@effect/vitest` owns test execution for every test that invokes an Effect.
- Pure non-Effect tests remain ordinary Vitest tests.

## What to build

Establish the shared test execution convention for Effect values.
Migrate shared test helpers to expose Effect programs and Layers for caller-owned test execution.

## Primary verification seam

A shared test helper consumer executes its Effect through `it.effect` or `it.scoped` without a direct `Effect.run*` call in the helper.

## Acceptance criteria

- [ ] Shared test helpers that currently execute Effects expose Effect programs or Layers.
- [ ] Helper consumers execute those Effects through `@effect/vitest`.
- [ ] The supported convention distinguishes Effect-invoking tests from pure non-Effect tests.
- [ ] Existing helper consumer behavior remains unchanged.

## Blocked by

None - can start immediately.
