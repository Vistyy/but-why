# Apply measured Vitest worker parallelism

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)
- [Vitest worker parallelism experiment](../spikes/vitest-worker-parallelism.md)

## Behaviors owned

- Routine and complete test suites use three Vitest thread workers, as supported by the worker parallelism experiment.
- Vitest retains module-graph reuse through `isolate: false`, as required by the approved execution model.
- Routine and complete suite membership remains unchanged, as required by the Test Suite Feedback Loop Redesign.
- Quality commands retain complete failure diagnostics and existing elapsed-time behavior, as required by the Test Suite Feedback Loop Redesign.
- Final measurements compare the three-worker quality commands with the accepted single-worker baseline.

## What to build

Apply the measured three-worker execution model as one configuration migration.
Retain the accepted thread pool and module-isolation behavior.
Do not change test membership, test assertions, external contracts, or quality-command composition in this task.
Record three uncontended measurements for each quality command in the locked Nix environment.

## Primary verification seam

Three consecutive uncontended locked-Nix runs each of `just quality` and `just full-quality`.

## Acceptance criteria

- [ ] Vitest runs the routine and complete suites with three thread workers and `isolate: false`.
- [ ] Every selected routine and complete test passes without changing suite membership.
- [ ] Three consecutive locked-Nix runs of `just quality` pass and record their median wall time.
- [ ] Three consecutive locked-Nix runs of `just full-quality` pass and record their median wall time.
- [ ] The recorded evidence compares the three-worker medians with the accepted single-worker baseline.
- [ ] The final quality commands remain within their approved operating budgets.

## Blocked by

None - can start immediately.
