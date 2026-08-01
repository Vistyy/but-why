# CLI Loading Evidence

The production TypeScript NodeNext build emits `dist/cliCommandTree.js` with native dynamic import targets for Task, Change, Validation Run, initialization, and dashboard command owners.

The emitted main entry has no static runtime import of those command owner modules.

A locally packed `but-why-0.0.1.tgz` was installed into a clean temporary directory with pnpm.

The installed `by --help` and `by --version` commands completed successfully.

The current compiled executable and the installed tarball executable were measured in randomized order with 15 fresh processes per representative command.

The measurements are comparative evidence only and do not define a latency budget.

| Command | Current median | Installed candidate median |
| --- | ---: | ---: |
| `--help` | 606.438 ms | 610.236 ms |
| `--version` | 600.649 ms | 604.174 ms |
| `task list` | 660.635 ms | 664.461 ms |
| `change list` | 713.764 ms | 725.289 ms |
| `validation-run show missing-validation-run` | 636.052 ms | 649.362 ms |

The focused CLI tests, process-boundary tests, typecheck, and Fallow checks passed during implementation.
