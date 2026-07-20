# ast-grep rule tests

`structural-bans-test.yml` verifies that each structural ban catches representative violations.

Run the complete check:

```bash
just ast-grep-check
```

The command runs fixture tests and scans the paths selected by each rule.
Production rules scan `src/**/*.ts`.
The Effect test-execution rule scans `test/**/*.ts`, including `test/support/`.

The production seam files contain the permitted SQLite, process, Effect, output, Sandcastle, child-process, Task ID, filesystem, JSON, and wall-clock shapes.
The command fails when a rule allows the wrong path or finds a prohibited shape.
