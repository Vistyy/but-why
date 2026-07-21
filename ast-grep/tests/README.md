# ast-grep rule tests

`structural-bans-test.yml` verifies the repository's closed TypeScript syntax rules.
Each rule has valid and invalid examples.
The fixtures verify whether the named syntax matches without pinning diagnostic formatting or source offsets.

Run the complete check:

```bash
just ast-grep-check
```

The command runs the native ast-grep tests and scans the paths selected by each rule.
Production rules scan `src/**/*.ts`.
The Effect test-execution rule scans `test/**/*.ts`, including `test/support/`.

These rules check only the syntax named by their diagnostics.
Each `ignores` entry limits a syntax exception to an exact path.
Architecture documentation and Standards review determine whether the path remains valid.
Fallow owns named import seams, behavior tests own runtime contracts, and Standards review owns semantic naming and module ownership.
