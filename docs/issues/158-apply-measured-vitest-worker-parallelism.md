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

- [x] Vitest runs the routine and complete suites with three thread workers and `isolate: false`.
- [x] Every selected routine and complete test passes without changing suite membership.
- [x] Three consecutive locked-Nix runs of `just quality` pass and record their median wall time.
- [x] Three consecutive locked-Nix runs of `just full-quality` pass and record their median wall time.
- [x] The recorded evidence compares the three-worker medians with the accepted single-worker baseline.
- [x] The final quality commands remain within their approved operating budgets.

## Scoped implementation record

- Baseline: `63010980bf035afd8122501d73436c7597243b16`.
- Spec review source: this task document.
- Normative traceability: `docs/specs/test-suite-feedback-loop-redesign.md` and `docs/spikes/vitest-worker-parallelism.md`.
- Primary public verification seam: three consecutive locked-Nix runs each of `just quality` and `just full-quality`.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Three thread workers with module-graph reuse | `vitest.config.ts` | Routine and complete Vitest runs through Just | Configuration and quality command output |
| Preserve selected suite membership and passing tests | Existing `BY_TEST_SUITE` selection in `vitest.config.ts` | `just quality` and `just full-quality` test reports | 261 routine tests and 321 complete tests pass, with one intentional skip in each suite |
| Record three-run quality medians | Repository `quality` recipe | Three consecutive `nix develop -c just quality` runs | Median wall time table in this task |
| Record three-run full-quality medians | Repository `full-quality` recipe | Three consecutive `nix develop -c just full-quality` runs | Median wall time table in this task |
| Compare with the accepted single-worker baseline | This task's timing evidence | Quality command elapsed-time output | Comparison with Task 134 baseline values |
| Remain within approved budgets | Existing quality command budgets | Quality command success and elapsed-time output | 10-second and 30-second operating budgets, plus 15-second and 60-second completion gates |

## Required validation

- Three consecutive uncontended locked-Nix runs of `just quality`.
- Three consecutive uncontended locked-Nix runs of `just full-quality`.
- `nix develop -c just quality` and `nix develop -c just full-quality` include the repository static checks, selected tests, and production build.

## Decision ledger

- Local: change only `maxWorkers` from `1` to `3` because the approved worker experiment supports three workers while retaining `pool: "threads"` and `isolate: false`.
- Local: use the existing quality command interface as the primary verification seam because the task forbids changing suite membership and quality-command composition.

## Final verification

The routine suite passed with 261 tests and one intentional skip in all three runs.
The complete suite passed with 321 tests and one intentional skip in all three runs.
Static checks, the production build, and Fallow checks passed through both quality commands.

Measurements were taken in three consecutive uncontended locked-Nix runs after the implementation commit.
Task 134's accepted single-worker baselines are 9.427 seconds for `just quality` and 29.658 seconds for `just full-quality`.

| Command | Run 1 | Run 2 | Run 3 | Three-worker median | Accepted single-worker baseline | Improvement | Operating budget | Completion gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `just quality` | 6.573 s | 6.553 s | 6.616 s | 6.573 s | 9.427 s | 30.3% faster | 10 s | 15 s |
| `just full-quality` | 18.417 s | 17.994 s | 18.053 s | 18.053 s | 29.658 s | 39.1% faster | 30 s | 60 s |

## Blocked by

None - can start immediately.
