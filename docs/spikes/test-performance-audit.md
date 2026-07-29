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

The four tests that require separate operating-system processes moved unchanged to `test/task/task-cli-process.boundary.test.ts`.
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

## BY-48 measurement record

The fixed measurement method is a focused `just test <file>` invocation in the locked development environment with no competing workload.

The Candidate capture boundary fixture changed from repeated repository initialization to one initialized template and isolated clones.

| Hotspot | Before | After | Change |
| --- | ---: | ---: | ---: |
| `test/change/change-candidate-capture.boundary.test.ts` | 8.503 s | 4.457 s | 47.6% faster |
| `test/validation/candidate-acceptance-review.boundary.test.ts` | 13.509 s | 12.498 s | 7.5% faster wall time; 26.2% faster Vitest test time |
| `test/publication/publication-policy.boundary.test.ts` | 5.796 s | 3.630 s | 37.4% faster |
| `test/repository/quality-interface.boundary.test.ts` | 12.935 s | 8.780 s | 32.1% faster |
| `test/task/task-cli-process.boundary.test.ts` | 12.028 s | 10.840 s | 9.9% faster wall time; 12.4% faster Vitest test time |

The Acceptance Review rewrite uses the owning Acceptance Review and Specialist Review phase seams for result variations.
One complete Candidate Validation path remains for Validation Workspace composition and prerequisite-check behavior.

The accepted main baseline is a 6.461 s three-run routine-test median and a 35.640 s three-run complete-test median.
The final three-run measurements used uncontended supported commands, and each command reported zero queue time.

| Command | Run 1 execution | Run 2 execution | Run 3 execution | Median execution | Queue time |
| --- | ---: | ---: | ---: | ---: | ---: |
| `just quality` | 10.449 s | 10.606 s | 11.377 s | 10.606 s | 0 s each |
| `just full-quality` | 38.733 s | 37.224 s | 37.031 s | 37.224 s | 0 s each |

The routine result is within the 15-second completion limit but above the 10-second operating target.
The complete result is above both the 20-second median target and the 30-second per-run limit.
All six commands passed and left the working tree unchanged.
