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
- ast-grep for exact structural rules over maintained TypeScript source.
- Remark for Markdown link and anchor validation.
- Effect SQL with the `@effect/sql-sqlite-node` Adapter for SQLite access.

## Quality policy

Fallow enforces these direct health limits:

- Maximum cyclomatic complexity: 20.
- Maximum cognitive complexity: 15.
- Maximum CRAP: 30.

Fallow reports unit size, composite scores, and hotspots as review information.
Fallow blocks direct complexity findings through the limits above.
`just fallow-check` blocks dependency, dead-code, import-boundary, and direct health findings.
The command reports duplication findings without treating the duplication report as a blocking result.

Vitest measures executable statements in every `src/**/*.ts` module.
Untested executable modules appear at zero coverage.
TypeScript declaration-only modules have no executable output and therefore have no coverage measurement.
Tests cover public behavior and applicable external contracts.

ast-grep checks only the syntax named by each rule.
Fallow enforces the import boundaries defined in `.fallowrc.jsonc` and `fallow-rules/architecture.json`.
Biome checks formatting and lint rules.
TypeScript checks types.
Vitest checks product behavior and coverage.
`just config-check` checks quality-tool configuration.

## Verification environment

The locked Nix environment is authoritative for repository verification.
Enter the environment through direnv, then run `just init` and `just quality`.
Non-interactive automation can run `nix develop -c just <recipe>`.

## Commands

Run `just` to list available recipes.
Use Just recipes because they define the repository's supported toolchain.
