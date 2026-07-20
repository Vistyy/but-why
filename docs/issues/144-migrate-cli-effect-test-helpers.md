# Migrate CLI Effect test helpers

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- CLI test helpers expose Effect programs instead of executing an Effect runtime.
- CLI tests that use those helpers execute through `@effect/vitest`.
- Existing CLI command assertions, output, errors, and exit-code assertions remain unchanged.

## What to build

Migrate `test/support/by-cli.ts` and every test that calls its Effect-executing helpers to the shared Effect test execution convention.
Keep process-backed CLI tests ordinary Vitest tests when they do not invoke an Effect.

## Primary verification seam

An in-process CLI test executes its helper-provided Effect through `it.effect` without a direct `Effect.run*` call in the helper and preserves its command assertion.

## Acceptance criteria

- [ ] CLI test helpers that invoke Effects expose Effect programs without direct `Effect.run*` calls.
- [ ] Every in-process CLI helper consumer uses `it.effect` or `it.scoped`.
- [ ] Process-backed CLI tests that do not invoke an Effect remain ordinary Vitest tests.
- [ ] Existing CLI command assertions, output, errors, and exit-code assertions remain unchanged.

## Blocked by

- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
