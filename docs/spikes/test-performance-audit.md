# Task CLI test performance experiment

## Summary verdict

The Task CLI behavior suite can fall from 38.66 seconds to about 3.15 seconds without replacing real Git or SQLite behavior with fakes.
The four cross-process concurrency tests remain real and take about 17.30 seconds in a separate file.
This experiment validates the proposed seam split for one hotspot, but it does not validate the 10-15 second target for the complete routine suite.

## Baseline measured

The original `test/task-cli.test.ts` contained 46 tests.
The file took 38.66 seconds in isolation.
The complete non-coverage suite took 103.83 seconds.

The four process-backed tests took approximately 21 seconds when measured individually.
The remaining 42 tests repeatedly paid for executable startup during repository initialization and fixture Task creation.

## Experiment

The experiment keeps all 46 assertions and uses the existing public CLI interface.
The 42 routine Task CLI tests initialize repositories and create fixture Tasks through `runByInProcessEffect`.
Those tests still use real Git repositories, real SQLite persistence, migrations, repository identity, and filesystem state.

The four tests that require separate operating-system processes moved unchanged to `test/task-cli-process.test.ts`.
They continue to verify cross-process persistence, concurrent comment appends, concurrent dependency replacement, and concurrent Task creation.

## Results

Three isolated runs produced these wall times:

| Workload | Run 1 | Run 2 | Run 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| 42 routine Task CLI tests | 3.147 s | 3.158 s | 3.127 s | 3.147 s |
| 4 process-backed Task CLI tests | 17.298 s | 17.067 s | 18.059 s | 17.298 s |

Running both files together completed in 17.14 seconds because Vitest scheduled the files concurrently.
The complete non-coverage suite completed in 97.14 seconds.
All 378 enabled tests passed, and the Herdr smoke test remained skipped.

## What improved

The routine Task CLI feedback became approximately 12 times faster.
The routine file now fits comfortably inside a 10-15 second quality budget.
The process boundary remains covered by four focused tests.
No Task CLI test was deleted.

## What remains unproven

The complete suite improved by only about 6.7 seconds because other Git, worktree, validation, and process-heavy files became the critical path.
The experiment does not prove that the complete routine suite can reach 10-15 seconds.
The experiment does not reduce the cost of the four process-backed tests.
Coverage instrumentation was not part of the isolated benchmark.

## Recommendation

Apply the same contract-first split to the remaining dominant files.
Keep ordinary behavior and policy matrices on existing in-process interfaces.
Keep one focused real-boundary matrix for each distinct Git, worktree, SQLite concurrency, or executable-process defect class.
Do not move a test to the slow suite only because its current fixture is inefficient.

## Follow-up

Measure the next largest critical-path file after each slice.
Re-run the complete suite after each slice because isolated savings do not add directly under Vitest parallelism.
Add the 15-second and 30-second soft warnings only after the suite commands and membership are implemented.
