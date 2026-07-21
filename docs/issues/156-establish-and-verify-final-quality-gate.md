# Establish and verify the final quality gate

## Specification

- [Target quality policy](../tooling.md#quality-policy)
- [Task 148 audited baseline](148-establish-audited-quality-baseline.md)
- [Architecture](../architecture.md)

## Behaviors owned

- The achieved behavior-first coverage becomes the blocking non-regression floor.
- Fallow boundaries describe the final source ownership after hierarchy consolidation.
- Every standard Just command uses the locked project toolchain and returns a truthful status.
- A disposable locked-Nix checkout initializes, verifies, and remains clean.
- Baseline coverage boundary C1 belongs to this task.

## What to build

Close the quality-recovery program after every behavior and migration task is complete.

Measure the repaired repository and set the achieved coverage thresholds.
Update only paths and ownership rules changed by the final source hierarchy.
Remove temporary recovery wording and verify the complete command interface from a clean checkout.

## Primary verification seam

A disposable checkout runs `nix develop -c just init`, `nix develop -c just quality`, and `git status --short`.

## Acceptance criteria

- [ ] Coverage includes every executable production module and meets the achieved statement, branch, function, and line floors.
- [ ] Coverage boundary C1 is classified through the installable-package process seam without adding artificial in-process entrypoint behavior.
- [ ] Fallow dead-code, ownership, and direct health checks block regressions, and its duplication report has no findings.
- [ ] ast-grep native valid and invalid fixtures and the production scan pass.
- [ ] Biome, TypeScript, Vitest, Remark, configuration, build, and package checks pass through Just.
- [ ] Existing tools enforce deterministic contracts, while architecture documentation and Standards review own semantic decisions.
- [ ] `just init` and `just quality` pass in a disposable locked-Nix checkout.
- [ ] The disposable checkout remains clean after verification.

## Blocked by

- [Task 135](135-consolidate-source-hierarchy.md)
