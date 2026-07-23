# Tooling

## Runtime

The repository uses ESM TypeScript on Node.js 24.x.

Nix provides the authoritative development environment.
Direnv enters the locked Nix development shell when a developer enters the repository directory.
Run `just init` after entering the environment.
Corepack is not part of the repository toolchain.

A non-Nix environment may run repository commands when it provides Node.js 24.x, pnpm 10.28.0, Just, and the installed project dependencies.
Only the locked Nix environment provides authoritative verification.

## Quality tools

The project uses:

- Vitest for tests and coverage.
- Biome for formatting and linting.
- TypeScript for strict type checking.
- Fallow for dependencies, dead code, import boundaries, duplication, and code health.
- ast-grep for six exact TypeScript syntax contracts.
- Remark for Markdown link and anchor validation.
- Effect SQL with the `@effect/sql-sqlite-node` Adapter for SQLite access.

## Blocking quality policy

`just quality` is the blocking routine acceptance command.
It runs routine tests, formatting, linting, type checking, documentation validation, ast-grep, blocking Fallow checks, and the production build.
`just full-quality` runs the complete selected test suite plus the same static checks and production build.
Neither blocking quality command generates coverage.

Fallow blocks dead code, dependency errors, cycles, invalid suppressions, and named architecture contracts.
Coverage-based complexity, CRAP, and maintainability results are advisory health evidence.

Fallow enforces three architecture contracts:

- Change workflows use ports instead of concrete Adapters or composition.
- CLI modules do not import storage.
- Domain modules do not import Node infrastructure.

Files outside the named Fallow zones receive no architecture claim.

ast-grep blocks these syntax contracts:

- Process properties belong to the CLI entry point.
- Effect tests use the Effect Vitest runtime.
- TOON belongs to the output codec.
- Sandcastle factories belong to workspace creation.
- Task identity branding belongs to `taskId.ts`.
- Wall-clock reads belong to the CLI entry point.

Vitest measures executable statements in every `src/**/*.ts` module.
Untested executable modules appear at zero coverage.
TypeScript declaration-only modules have no executable output and therefore have no coverage measurement.
The current coverage policy has no percentage threshold.

## Advisory health reports

`just health` runs coverage before producing Fallow health and duplication reports.
The reports include complexity, CRAP, function size, composite scores, hotspots, coverage gaps, and duplication.
Advisory reports do not determine the `just quality` result.
A report becomes implementation work only when repository evidence establishes a concrete defect or maintenance cost.

## Verification environment

The locked Nix environment is authoritative for repository verification.
Enter the environment through direnv, then run `just init` and `just quality`.
Non-interactive local automation can run `nix develop -c just <recipe>`.

## Commands

Run `just` to list available recipes.
Use Just recipes because they define the repository's supported toolchain.
