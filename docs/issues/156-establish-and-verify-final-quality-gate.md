# Establish and verify the final quality gate

## Specification

- [Tooling](../tooling.md)
- [Architecture](../architecture.md)

## Behaviors owned

- Repaired behavior coverage becomes the blocking non-regression floor.
- The final source hierarchy satisfies the selected architecture and structural checks.
- Every blocking Just command returns a truthful status through the locked local toolchain.

## What to build

Measure coverage after the storage migration and source consolidation are complete.
Set the achieved statement, branch, function, and line coverage thresholds.
Update Fallow paths only where the final source hierarchy moved a governed seam.
Verify the complete local quality interface from a clean locked-Nix checkout.

## Primary verification seam

A clean local checkout runs `nix develop -c just init`, `nix develop -c just quality`, and `git status --short`.

## Acceptance criteria

- [ ] Coverage includes every executable production module and meets the achieved statement, branch, function, and line thresholds.
- [ ] Fallow dependency, dead-code, architecture, and direct health checks pass.
- [ ] ast-grep native valid and invalid fixtures and the production scan pass.
- [ ] Formatting, linting, type checking, tests, documentation validation, and build checks pass through Just.
- [ ] `just init` and `just quality` pass in a clean locked-Nix checkout.
- [ ] The checkout remains clean after verification.

## Blocked by

- [Task 135](135-consolidate-source-hierarchy.md)
- [Task 154](154-cover-task-dependency-cli-errors.md)
- [Task 155](155-cover-validation-workspace-recovery.md)
- [Task 157](157-cover-change-implement-handoff-errors.md)
