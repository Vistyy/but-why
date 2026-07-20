# Enforce Effect test execution

## Status

Done.

## Completion

- Implementation: `c87b2e1a7183df2df84fb9db418d49828ec0bde2`
- Review correction: `279c0c8e0c1067eaabf704bc3ce0dd2d97046953`
- Review correction: `bdf66cdca38ec06287de8bfe91e76fdef010e89f`

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
- `docs/issues/142-migrate-remaining-effect-tests.md`
- `docs/issues/144-migrate-cli-effect-test-helpers.md`

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

- [x] The structural rule scans `test/`, including `test/support/`.
- [x] The rule rejects direct `Effect.run*` calls in test code.
- [x] Rule tests demonstrate valid and invalid test examples.
- [x] The full test suite and structural checks pass without direct test runtime calls.

## Blocked by

- `docs/issues/142-migrate-remaining-effect-tests.md`
- `docs/issues/144-migrate-cli-effect-test-helpers.md`
