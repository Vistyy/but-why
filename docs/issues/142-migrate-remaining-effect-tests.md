# Migrate remaining non-CLI Effect tests

## Status

Done.

## Completion

- Implementation: `532bd53a28563ee3bfc7388d04d82b526bd94398`

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- Remaining non-CLI tests that invoke Effects execute through `@effect/vitest`.
- Reviewer runtime, reviewer output contract, token usage, and module-seam assertions remain unchanged.

## What to build

Migrate the remaining non-CLI adapter and value tests that invoke Effects to the shared Effect test execution convention.
Do not change the adapters, decoders, contracts, or module seams under test.

## Primary verification seam

Each migrated public adapter, decoder, or module-seam test executes through `it.effect` and preserves its current assertion.

## Acceptance criteria

- [x] Reviewer runtime tests use `@effect/vitest`.
- [x] Reviewer output contract tests use `@effect/vitest`.
- [x] Token usage and module-seam Effect tests use `@effect/vitest`.
- [x] Existing success and typed-error assertions remain unchanged.

## Blocked by

- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
