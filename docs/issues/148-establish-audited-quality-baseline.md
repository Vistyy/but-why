# Establish the audited quality baseline

## Specification

- [Codebase quality tooling PRD](../prds/codebase-quality-tooling-prd.md)
- [Target quality policy](../tooling.md#quality-policy)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)

## Behaviors owned

- Just exposes the supported initialization, test, coverage, build, documentation, configuration, and quality commands.
- The locked Nix environment provides Node.js 24, pnpm 10.28.0, and Just.
- Coverage measures every executable production module through Istanbul and reports untested runtime code at zero.
- TypeScript erases declaration-only modules before Istanbul instrumentation.
- Fallow enforces named ownership seams and direct health limits and reports duplication evidence.
- ast-grep enforces only current closed syntax contracts with native valid and invalid fixtures.
- Biome, TypeScript, Vitest, Remark, and each owning tool validate their supported files without custom policy reimplementations.

## What to build

Install the repository quality baseline before repairing the failures it exposes.

Use existing tools for their native responsibilities.
Keep semantic architecture and naming decisions in project documentation and Standards review.
Keep the baseline deliberately red only for recorded implementation failures.

## Baseline inventory

### Architecture ownership

| ID | Finding | Owner |
| --- | --- | --- |
| A1 | Change Start workflow imports its Git adapter. | Task 150 |
| A2 | Change reconciliation imports its cleanup adapter. | Task 153 |
| A3 | Change Submit imports its GitHub target adapter. | Task 153 |
| A4 | Candidate capture opens repository storage. | Task 151 |
| A5 | Candidate capture imports its Git adapter. | Task 151 |

### Duplication

| ID | Shared behavior | Owner |
| --- | --- | --- |
| D1 | Candidate integrity handling across review phases. | Task 152 |
| D2 | Local subprocess output capture. | Task 154 |
| D3 | Change Start and Prepare command wiring. | Task 150 |
| D4 | Change Findings and Validation Run command loading. | Task 152 |
| D5 | Global Config and Repo Config diagnostic construction. | Task 155 |
| D6 | Synchronous local repository state loaders. | Task 147 |
| D7 | Repository Preparation and Check completion markers. | Task 152 |
| D8 | Validation Finding row mapping. | Task 152 |
| D9 | Change row mapping. | Task 153 |
| D10 | Change publication transaction guards. | Task 153 |
| D11 | Change completion transaction guards. | Task 153 |
| D12 | Change cleanup transaction guards. | Task 153 |
| D13 | Task approval transaction guards. | Task 150 |
| D14 | Task transition transaction guards. | Task 150 |
| D15 | Prepare and Check Artifact construction. | Task 152 |

### Dead code

Fallow reports no dead-code findings in the maintained development graph.
Coverage boundary C3 remains tracked because its helper is used by tests but has no production caller.

### Direct CRAP findings

| ID | Behavior | Owner |
| --- | --- | --- |
| H1 | Reconcile one Change. | Task 153 |
| H2 | Parse a GitHub remote target. | Task 153 |
| H3 | Convert a Validation Tooling Failure to its record. | Task 152 |
| H4 | Render a Task dependency replacement error. | Task 150 |
| H5 | Prepare an existing validation worktree. | Task 152 |
| H6 | Escape a persisted JSON string value. | Task 149 |
| H7 | Record Change cleanup. | Task 153 |
| H8 | Render the actual value in a contract diagnostic. | Task 155 |
| H9 | Render a Task creation dependency error. | Task 150 |
| H10 | Render a Change handoff-file error. | Task 153 |
| H11 | Run Change reconciliation from the CLI. | Task 153 |
| H12 | Route the Change reconciliation result. | Task 153 |
| H13 | Reconcile Change cleanup. | Task 153 |

### Coverage boundary

Istanbul instruments 112 executable source modules.
Sixteen declaration-only modules compile without measurable statements.

| ID | Coverage boundary | Owner |
| --- | --- | --- |
| C1 | The process entry is measured at zero because installable-package tests execute it in child processes. | Task 156 |
| C2 | Direct output-format selection lacks measured branch coverage. | Task 153 |
| C3 | `closeAllStateDatabases` in `src/init/stateDatabase.ts` is test-visible but has no production caller. | Task 147 |

## Primary verification seam

Run `just quality` in the locked Nix environment and compare its output with the recorded baseline inventory.

## Acceptance criteria

- [x] `just init` succeeds in the locked Nix environment and rejects unsupported Node.js or pnpm versions.
- [x] Tests pass with 344 passing tests and one conditional smoke-test skip.
- [x] Coverage reports every executable production module, including zero-covered modules.
- [x] The sixteen declaration-only modules remain naturally absent from executable coverage without artificial runtime statements or path exclusions.
- [x] Coverage reports 81.97% statements, 68.94% branches, 90.20% functions, and 84.79% lines before repairs.
- [x] Formatting, linting, type checking, documentation, configuration, ast-grep, and build checks pass.
- [x] ast-grep has ten approved syntax rules with native valid and invalid fixtures.
- [x] Fallow reports exactly five ownership violations, fifteen duplication groups, and thirteen direct CRAP findings.
- [x] Disposable probes confirm that Fallow blocks Change workflow imports from Adapters or composition, CLI imports from storage, and domain imports from Node infrastructure.
- [x] Fallow reports large functions as review evidence without a custom size gate.
- [x] No custom quality script or exception manifest duplicates an owning tool or semantic review.

## Blocked by

None - can start immediately.
