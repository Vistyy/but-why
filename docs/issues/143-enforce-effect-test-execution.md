# Enforce Effect test execution

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-establish-effect-test-execution.md`
- `docs/issues/140-migrate-lifecycle-sensitive-effect-tests.md`
- `docs/issues/141-migrate-candidate-workflow-effect-tests.md`
- `docs/issues/142-migrate-adapter-and-value-effect-tests.md`

## Behaviors owned

- Test code does not execute Effects through direct `Effect.run*` calls.
- The structural check rejects a new direct Effect runtime call under `test/`.
- The executable boundary remains the supported production runtime boundary.

## What to build

Add a test-specific structural rule that rejects direct `Effect.run*` calls under `test/`.
Remove the remaining direct test runtime calls after the migration tasks complete.

## Primary verification seam

The structural check fails for a direct `Effect.run*` call in test code and passes for the migrated test suite.

## Acceptance criteria

- [ ] The structural rule scans `test/`, including `test/support/`.
- [ ] The rule rejects direct `Effect.run*` calls in test code.
- [ ] Rule tests demonstrate valid and invalid test examples.
- [ ] The full test suite and structural checks pass without direct test runtime calls.

## Blocked by

- `docs/issues/140-migrate-lifecycle-sensitive-effect-tests.md`
- `docs/issues/141-migrate-candidate-workflow-effect-tests.md`
- `docs/issues/142-migrate-adapter-and-value-effect-tests.md`
