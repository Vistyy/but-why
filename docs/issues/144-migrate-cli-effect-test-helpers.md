# Establish the in-process CLI Effect test harness

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
- `spikes/effect-first-path/README.md`

## Behaviors owned

- In-process CLI tests execute one shared Effect program through Vitest-managed Effect execution.
- The in-process CLI test harness owns CLI environment construction and result serialization.
- Process-backed CLI tests continue to verify executable and environment behavior through ordinary Vitest execution.
- Existing CLI commands, output, errors, state assertions, and exit-code assertions retain their current behavior.

## What to build

Establish one Effect-native in-process CLI test harness.
The harness must expose an Effect without executing an Effect runtime.
Remove the separate synchronous and asynchronous in-process execution paths.

Migrate each in-process consumer through `it.effect` or `it.scoped` according to its actual lifecycle needs.
Keep tests on the process-backed adapter when executable startup, process environment, or process output is observable behavior.

Preserve command-specific assertions at the caller-visible CLI seam.
Do not add a generic output matcher that hides the JSON or TOON contract.

## Primary verification seam

An in-process CLI test executes a command through `it.effect` and the shared harness.
The test observes the same command result without a direct `Effect.run*` call or a second runtime path.

## Acceptance criteria

- [ ] The in-process CLI test harness exposes one Effect-returning execution interface.
- [ ] The in-process CLI test harness contains no direct `Effect.run*` call.
- [ ] The separate synchronous and asynchronous in-process helper implementations are removed.
- [ ] Every in-process CLI harness consumer executes through `it.effect` or `it.scoped`.
- [ ] Process-backed CLI tests remain ordinary Vitest tests when process behavior is part of the contract.
- [ ] Existing command arguments, output assertions, error assertions, state assertions, and exit-code assertions remain behaviorally unchanged.
- [ ] The focused in-process CLI suites pass through the shared execution interface.

## Blocked by

- `docs/issues/139-migrate-candidate-validation-effect-tests.md`
