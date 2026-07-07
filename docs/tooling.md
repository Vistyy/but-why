# Tooling

This document describes development tooling for this repository.

## Runtime and environment

The repository uses ESM TypeScript on Node.js 24.x.

Nix provides the blessed reproducible development environment.

Nix is optional for development.

A non-Nix environment may run the project if it provides Node.js 24.x, pnpm, Just, and installed project dependencies.

Corepack is not part of the repo toolchain.

## Quality tools

The project uses:

- Vitest for tests.
- Biome for formatting and linting.
- TypeScript strict typechecking.
- Fallow for codebase health, dead code, duplication, dependency, and architecture boundary checks.
- ast-grep for blocking structural bans over active production TypeScript source.
- `node:sqlite` for SQLite access.

## CLI output boundary

CLI output is converted to TOON-style text only at the stdout boundary.

Internal command logic uses typed JSON-like objects.

## Commands

Run `just` with no arguments to list available recipes.

Agents should use Just recipes instead of invoking pnpm directly.
