# Tooling

## Runtime

The repository uses ESM TypeScript on Node.js 24.x.

Nix provides the supported reproducible development environment.
Direnv enters the locked Nix development shell when a developer enters the repository directory.
Developers then run `just init` and `just quality` without a Nix prefix.
CI and non-interactive automation may use `nix develop -c just <recipe>`.
A non-Nix environment may run repository commands when it provides Node.js 24.x, pnpm, Just, and installed project dependencies.
Only the locked Nix environment provides authoritative baseline verification.
Corepack is not part of the repository toolchain.

## Quality tools

The project uses:

- Vitest for tests
- Biome for formatting and linting
- TypeScript for strict type checking
- Fallow for dead code, duplication, dependency, and architecture checks
- ast-grep for blocking structural rules over active TypeScript source
- Effect SQL with the `@effect/sql-sqlite-node` adapter for SQLite access

## Target quality policy

The repository does not yet satisfy this target policy.
The quality-recovery work must make `just quality` enforce the complete policy before the integration branch merges.
Quality configuration is part of the repository architecture.
A feature task must not weaken a check merely to make its implementation pass.
A task or approved architecture contract must own each quality-policy change.
The owning task must record the exception's exact scope, current reason, and governing contract.
Native rule tests must provide adversarial evidence when the owning tool supports fixtures.
Fallow boundary changes require a disposable violation probe because Fallow has no native boundary-fixture format.
The Standards reviewer must approve the quality-policy change.

The quality baseline must configure Fallow with its direct default limits as blocking checks:

- Maximum cyclomatic complexity: 20.
- Maximum cognitive complexity: 15.
- Maximum CRAP: 30.

Unit-size, composite-score, and hotspot reports must remain visible review evidence.
These reports must not replace direct blocking complexity findings.
CRAP must use measured coverage.
Tests must cover every public behavior and applicable external contract.
Every production file must appear in coverage, including untested files at zero percent.
After uncovered behavior is resolved or classified as unreachable infrastructure, the quality gate must use the achieved coverage as its blocking floor.

Fallow enforces import graphs, dependency ownership, dead code, duplication, and health.
ast-grep enforces exact structural patterns that it can determine reliably.
Biome and TypeScript enforce language-level correctness.
Vitest verifies product behavior.
Configuration checks validate the shape and integrity of quality policy without deciding semantic architecture.

## Continuous integration

CI is planned but not currently implemented.
This baseline records CI as deferred work.
Until the repository adds CI, final verification must run `just init` and `just quality` from a disposable checkout in the locked Nix environment.
A future CI pipeline must run the same Just recipes without separate tool commands.

## CLI output boundary

Command logic returns typed JSON-like objects.
The CLI converts those objects to TOON-style text only at the stdout boundary.

## Commands

Run `just` to list available recipes.
Use `just init` after entering the Nix development shell.
Use Just recipes because they define the repository's supported toolchain.
