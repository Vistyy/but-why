# Consolidate the source hierarchy

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0006-use-domain-centered-modular-monolith.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- The source hierarchy reflects the specification's Task and Change ownership model.
- Every top-level source folder has one domain owner or one clearly named shared role.
- Existing public behavior remains unchanged while surviving modules move to their final locations.

## What to build

Reorganize the surviving source modules after the Change-centered migration.
Group workflow code under its owning domain.
Group shared code by its documented adapter role.
Move files and update imports, tests, and architecture documentation.
Apply the global search-anchor contract and the canonical terms in `CONTEXT.md` to every moved public or domain-facing name.
Do not redesign public or internal interfaces.
Preserve public commands and persisted data.

## Primary verification seam

The complete Task-backed Change workflow produces the same public CLI results before and after relocation.
The full repository suite and Fallow import graph additionally verify the final source map.

## Scoped implementation record

- Baseline: `637d50257aad4b495f2bd64ec824b41470b1a350`.
- Spec review source: this task draft.
- Normative traceability: `docs/specs/taskless-changes-and-worktree-handoff.md`, `CONTEXT.md`, ADR 0006, and ADR 0008.
- Primary seam: the complete Task-backed Change workflow through the Change CLI with the existing public results and persisted state.
- Structural seam: the source hierarchy test and Fallow import graph.

### Acceptance verification map

1. `docs/architecture.md` documents the final top-level source roles.
   The source hierarchy test and `just fallow-check` verify the map.
2. `src/task/` owns Task intent, lifecycle, persistence interfaces, and Task composition.
   Task CLI tests verify the public seam through `just quality`.
3. `src/change/` owns Change, Candidate, submission, validation, publication, and Change composition.
   Change CLI integration tests verify the public seam through `just full-quality`.
4. Change composition calls the existing Change, Task, storage, and adapter interfaces.
   Change CLI integration tests and Fallow verify the ownership path.
5. `src/agent/`, `src/contracts/`, `src/init/`, `src/output/`, `src/repositoryPreparation/`, `src/sqlite/`, and `src/submissionEnvironment/` remain named shared roles.
   The source hierarchy test and Fallow verify the grouping.
6. The source hierarchy test rejects the retired `local*` and top-level Change workflow folders.
   `just fallow-check` verifies that no forwarding imports remain.
7. Moved modules preserve their existing exported interfaces.
   Existing module and CLI tests verify behavior through `just quality`.
8. CLI output, commands, and persisted state remain unchanged.
   Change and repository boundary tests verify the public and storage seams through `just full-quality`.
9. Moved public and domain-facing names use `Change`, `Candidate`, `Task`, `Validation`, and `Repository` search anchors.
   The source hierarchy test, documentation check, and Fallow verify the names.
10. Imports, tests, structural checks, and architecture documentation use the final hierarchy.
    `just docs-check`, `just ast-grep-check`, `just fallow-check`, and `just full-quality` verify the repository.
11. The full repository suite passes after the move.
    `just full-quality` is the blocking verification command.

### Decision ledger

- Local: nest Change-owned workflow modules under `src/change/`.
  ADR 0008 makes Change the durable owner of Candidates, Validation Runs, Findings, and delivery.
- Local: keep `agent`, `contracts`, `init`, `output`, `repositoryPreparation`, `sqlite`, and `submissionEnvironment` as top-level shared roles.
  The specification defines these as shared execution, contract, repository-context, output, preparation, persistence, and submission-environment adapters.
- Local: move composition loaders into their owning domains as `change/loadChangeInspection.ts`, `change/loadChangeSubmit.ts`, `change/loadChangeUseCases.ts`, `change/candidateValidation/candidateValidationLayer.ts`, and `task/loadTaskUseCases.ts`.
  This removes migration-only `local*` folders without changing the existing interfaces.
- Local: rename the `changeCandidateCapture` modules and identifiers to `candidateCapture` inside `src/change/`.
  `Candidate` and `Change` are the canonical terms, and the nested owner supplies the missing context.
- Local: place validation phases and Validation Run records under `src/change/validation/` and `src/change/validationRun/`.
  Change owns validation, while `repositoryPreparation` remains shared because implementation and validation use the same preparation interface.
- Local: place `repositoryStorageError.ts` under `src/contracts/`.
  CLI, Change, Task, and SQLite modules share the error contract, and Fallow keeps CLI modules independent from storage adapters.
- User-approved: update path-based Fallow and ast-grep rules to the final source hierarchy.
  The task requires structural checks to describe the final hierarchy, and this decision changes paths only without changing thresholds, exclusions, suppressions, or enforced behavior.

## Acceptance criteria

- [x] Every top-level `src/` folder has one documented domain owner or shared adapter role.
- [x] Task-owned code covers Task intent and Task lifecycle.
- [x] Change-owned code covers implementation, Candidates, submission, validation ownership, and delivery.
- [x] Cross-domain workflows live under one primary owner and call other modules through their existing interfaces.
- [x] CLI, persistence, repository, execution, and output adapters are grouped by clear shared roles.
- [x] No migration-only folder or forwarding module remains.
- [x] The reorganization does not redesign public or internal interfaces.
- [x] The reorganization preserves public commands and persisted data.
- [x] Public and domain-facing names use canonical project terms and remain precise search anchors.
- [x] Imports, tests, structural checks, and architecture documentation describe the final hierarchy.
- [x] The full repository suite passes after the move.

## Blocked by

- None.
  Task 147 completed the storage prerequisite before Task 135 started.
