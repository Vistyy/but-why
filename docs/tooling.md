# Tooling

## Runtime

The repository uses ESM TypeScript on Node.js 24.x.

Nix provides the supported reproducible development environment.
A non-Nix environment may be used when it provides Node.js 24.x, pnpm, Just, and installed project dependencies.
Corepack is not part of the repository toolchain.

## Quality tools

The project uses:

- Vitest for tests
- Biome for formatting and linting
- TypeScript for strict type checking
- Fallow for dead code, duplication, dependency, and architecture checks
- ast-grep for blocking structural rules over active TypeScript source
- `node:sqlite` for SQLite access

## CLI output boundary

Command logic returns typed JSON-like objects.
The CLI converts those objects to TOON-style text only at the stdout boundary.

## Commands

Run `just` to list available recipes.
Use Just recipes because they define the repository's supported toolchain.
