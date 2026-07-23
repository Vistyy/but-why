# Vitest worker parallelism experiment

## Summary verdict

Three Vitest workers reduce routine-suite wall time by 32 percent and complete-suite wall time by 39 percent.
All 24 measured runs passed without a test failure.
Four workers do not produce a meaningful additional wall-time improvement and use more memory.

The experiment supports changing `maxWorkers` from 1 to 3.
The experiment does not change the current configuration.

## Hypothesis

Two, three, or four Vitest workers will reduce median wall time by at least 20 percent relative to one worker.
Each configuration must pass three routine-suite runs and three complete-suite runs.
The experiment is inconclusive if a configuration fails or produces unstable results across the three runs.

## Baseline

The baseline uses the current `vitest.config.ts` execution model:

- `pool: "threads"`
- `isolate: false`
- `maxWorkers: 1`

The routine suite contains 261 passing tests and one intentional skip.
The complete suite contains 321 passing tests and one intentional skip.

## Experiment

The experiment ran worker counts 1, 2, 3, and 4.
Each worker count ran the routine suite three times and the complete suite three times.
The `--maxWorkers` Vitest argument changed only the worker count.
No source or configuration file changed during the measurements.

The experiment used these command forms in the locked Nix environment:

```bash
BY_TEST_SUITE=routine just test --maxWorkers WORKERS
BY_TEST_SUITE= just test --maxWorkers WORKERS
```

Bash measured elapsed, user, and system CPU time for each command.
A 50-millisecond process-tree sample measured peak resident memory for the command and its descendants.
Process-tree memory is comparable across runs but can count shared pages more than once.

## Results

### Routine suite

| Workers | Run 1 | Run 2 | Run 3 | Median wall | Median CPU | Median peak memory |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 6.912 s | 6.895 s | 6.900 s | 6.900 s | 87% | 879 MiB |
| 2 | 4.982 s | 5.002 s | 4.957 s | 4.982 s | 152% | 1,036 MiB |
| 3 | 4.640 s | 4.692 s | 4.685 s | 4.685 s | 198% | 1,311 MiB |
| 4 | 4.767 s | 4.643 s | 4.728 s | 4.728 s | 227% | 1,447 MiB |

### Complete suite

| Workers | Run 1 | Run 2 | Run 3 | Median wall | Median CPU | Median peak memory |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 26.885 s | 26.924 s | 26.804 s | 26.885 s | 110% | 879 MiB |
| 2 | 17.387 s | 17.109 s | 17.508 s | 17.387 s | 196% | 1,315 MiB |
| 3 | 16.423 s | 16.444 s | 17.046 s | 16.444 s | 242% | 2,015 MiB |
| 4 | 16.191 s | 16.320 s | 16.535 s | 16.320 s | 274% | 2,118 MiB |

All 24 runs passed.

## Interpretation

Two workers provide most of the improvement with a moderate memory increase.
Three workers improve the routine median by another 6 percent and the complete median by another 5 percent relative to two workers.
Four workers are slower than three workers for the routine suite.
Four workers improve the complete median by less than 1 percent while increasing CPU use and peak memory.

The three-worker result supports the hypothesis.
The four-worker result shows that the useful concurrency limit is three workers for the measured host and suite.

## Limitations

Three runs can reveal immediate shared-state failures but cannot prove long-term absence of flakiness.
The measurements use one development host and its available CPU and memory.
The peak-memory measurement is process-tree resident memory rather than unique proportional memory.
The experiment measures Vitest suites directly rather than concurrent repository workloads.
Task 156 owns capacity coordination between complete test and coverage workloads.

## Recommendation

Set `maxWorkers` to 3 while retaining `pool: "threads"` and `isolate: false`.
Run the supported quality gates after the configuration change.
If constrained environments cannot provide approximately 2 GiB of peak process-tree memory, select two workers instead.
