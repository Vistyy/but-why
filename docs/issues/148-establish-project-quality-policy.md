# Establish the project quality policy

## Status

Historical completion record.
Task 134 supersedes the blocking coverage-health policy with the approved routine and complete non-coverage quality interfaces.

## Specification

- [Tooling](../tooling.md)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)

## Behaviors owned

- Just exposes the supported initialization, blocking quality, advisory health, test, coverage, documentation, and build commands.
- The locked Nix environment provides Node.js 24, pnpm 10.28.0, and Just.
- `just quality` runs only blocking checks.
- `just health` reports advisory maintenance evidence without blocking completion.
- Coverage measures every executable production module through Istanbul and reports untested runtime code at zero.
- Fallow blocks selected dependency, dead-code, architecture, and direct health findings.
- ast-grep blocks six exact syntax contracts through native valid and invalid fixtures.
- Each owning tool validates its configuration through its supported command.

## What to build

Establish the approved project quality policy through the smallest native tool configuration that provides each selected signal.
Keep implementation failures visible for the migration Tasks that own the affected behavior.
Keep advisory reports outside the blocking gate.

## Primary verification seam

Run `just quality` and `just health` in the locked Nix environment.

## Acceptance criteria

- [x] `just init` succeeds in the locked Nix environment and rejects unsupported Node.js or pnpm versions.
- [x] Formatting, linting, type checking, tests, documentation validation, ast-grep, and build checks pass.
- [x] Coverage includes every executable production module without path exclusions for declaration-only modules.
- [x] Fallow blocks selected dependency, dead-code, architecture, cyclomatic, cognitive, and CRAP findings.
- [x] Fallow architecture enforces only the three contracts documented in `docs/tooling.md`.
- [x] ast-grep has six syntax rules with native valid and invalid fixtures.
- [x] `just health` reports duplication and health evidence without blocking completion.
- [x] No custom parser, finding inventory, or exception manifest duplicates an owning tool.

## Blocked by

None - can start immediately.
