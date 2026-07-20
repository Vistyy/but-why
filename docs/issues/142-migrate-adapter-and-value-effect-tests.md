# Migrate adapter and value Effect tests

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-establish-effect-test-execution.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- Adapter tests that invoke Effects execute through `@effect/vitest`.
- Value-level decoder and contract tests that invoke Effects execute through `@effect/vitest`.
- Existing public assertions remain unchanged.

## What to build

Migrate reviewer runtime, reviewer output contract, token usage, and module-seam tests that invoke Effects to the shared Effect test execution convention.
Do not change the adapters, decoders, or contracts under test.

## Primary verification seam

Each migrated public adapter or decoder test executes through `it.effect` and preserves its current assertion.

## Acceptance criteria

- [ ] Reviewer runtime tests use `@effect/vitest`.
- [ ] Reviewer output contract tests use `@effect/vitest`.
- [ ] Token usage and module-seam Effect tests use `@effect/vitest`.
- [ ] Existing success and typed-error assertions remain unchanged.

## Blocked by

- `docs/issues/139-establish-effect-test-execution.md`
