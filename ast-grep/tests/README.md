# ast-grep rule tests

`structural-bans-test.yml` verifies the repository's closed TypeScript syntax rules.
Each rule has valid examples, invalid examples, and reviewed diagnostic snapshots.

Run the complete check:

```bash
just ast-grep-check
```

The command runs the native ast-grep tests and scans the paths selected by each rule.
Production rules scan `src/**/*.ts`.
The Effect test-execution rule scans `test/**/*.ts`, including `test/support/`.

These rules check only the syntax named by their diagnostics.
Fallow owns project import boundaries, behavior tests own runtime contracts, and Standards review owns semantic naming and module ownership.
