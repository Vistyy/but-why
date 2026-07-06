# ast-grep rule tests

`structural-bans-test.yml` proves each structural ban catches representative violations.

`just ast-grep-check` also runs `ast-grep scan` over `src/**/*.ts`.
That scan is the path-aware allowed-seam check because the production seam files contain the allowed SQLite, process, Effect, output, Sandcastle, child-process, Task ID, filesystem, JSON, and wall-clock shapes.
If an allowed path is wrong, the production scan fails.
