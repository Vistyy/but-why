# Migrate validation execution and history

## Status

Done.

## Specification

- [Source specification decomposed from Task 146](146-migrate-state-stores-to-effect-programs.md)
- [Change-centered validation PRD](../prds/change-centered-validation-prd.md)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)

## Behaviors owned

- Candidate validation records Validation Runs, Findings, rounds, Artifacts, and Tooling Failures through Effect-native persistence.
- Validation Run inspection reads the same durable history through Change-owned interfaces.
- Prepare and Check phases interpret completion markers and record command evidence consistently.
- Acceptance and Specialist Review enforce the same Candidate integrity precondition while retaining phase-specific diagnostics.
- Validation workspace recovery and existing-worktree behavior remain covered.

## What to build

Migrate the complete Candidate validation history slice to Effect-native storage.

Share only the command evidence and Candidate integrity behavior that is identical across phases.
Preserve phase order, error types, Artifact names, and reviewer evidence.

## Scoped implementation record

- Baseline: `b2eea3f5d62674c4e1126324b50bdf437689dbc9`.
- Spec review source: this task draft.
- Normative traceability: Task 146, the Change-centered validation PRD, ADR 0014, `docs/architecture.md`, and the Effect-first storage spike.
- Primary seam: Candidate validation runs through all four phases before the Findings and Validation Run commands return the persisted evidence.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Validation execution and inspection use Effect-native persistence | Change-owned validation persistence and SQLite adapter | Candidate validation, Change Submit, Findings, and Validation Run integration | Production validation history uses `RepositorySql` Effects |
| Findings preserve their complete evidence and recheck behavior | Finding writes, reads, and previous-Candidate review lookup | Acceptance and Specialist recheck integration | Severity, files, Artifact references, producer, phase, and preceding-Candidate history remain durable |
| Prepare and Checks share command evidence behavior | Validation command runner and command evidence writer | Prepare and Check integration | Completion markers and the four command Artifacts have one implementation |
| Acceptance and Specialist Review share Candidate integrity behavior | Candidate integrity verification helper | Acceptance and Specialist integration | Both phases enforce the same precondition and retain distinct operation names |
| Every Tooling Failure variant has stable output | Tooling Failure mapping, persistence, and Validation Run view | Effect validation integration | All eight variants round-trip through SQLite and CLI output |
| Existing-worktree and cleanup behavior remains covered | Validation workspace lifecycle | Workspace lifecycle integration | Recovery and cleanup outcomes remain unchanged |

Required verification is `nix develop -c just quality` plus focused validation, inspection, publication, type-check, lint, formatting, ast-grep, docs, build, and Fallow commands.
The user approved the two pre-existing Task-153 Fallow violations as the only allowed nonzero gate result.

## Implementation decision ledger

- Local: keep domain rejections as successful Effect values and propagate repository storage failures through the typed error channel.
- Local: use `RepositorySql.transactionImmediate` for Validation Run start or reuse and atomic round evidence writes.
- Local: preserve the PRD's implicit recheck relationship through the immediately preceding Candidate and matching reviewer.
- Local: use canonical `created_at, id` ordering for Candidate and Validation Run history.
- User-approved: include publication's passing-validation-evidence lookup in Task 152 so no production validation-history caller uses synchronous storage.
- User-approved, deferred to Task 153: preserve the two pre-existing Fallow violations for reconciliation cleanup and GitHub target detection.
- Deferred to Task 153: migrate the remaining Submit, publication, and reconciliation persistence.
- Deferred to Task 135: consolidate the surviving source hierarchy and names.

## Primary verification seam

Candidate validation runs through Prepare, Checks, Acceptance Review, and Specialist Review, then the Findings and Validation Run commands return the complete persisted evidence.

## Acceptance criteria

- [x] Validation execution and inspection use Effect-native persistence.
- [x] Findings preserve optional severity, files, Artifact references, producer, phase, and recheck relationships.
- [x] Command completion and Artifact creation use one verified behavior across Prepare and Checks.
- [x] Acceptance and Specialist Review share Candidate integrity handling without losing phase-specific diagnostics.
- [x] Every Tooling Failure variant has stable persisted and displayed output coverage.
- [x] Existing-worktree preparation and cleanup outcomes are covered.

## Completion

- Implementation: `be289454f12ce2431ced2a5109577a1502397263`.
- Verification: 371 tests passed with one intentional skip.
- Type checking, linting, formatting, ast-grep, docs, build, focused validation, inspection, publication, and workspace lifecycle checks passed.
- `nix develop -c just quality` remains nonzero only for the two user-approved Task-153 Fallow boundary violations.
- Completion update: this administrative commit.
- Spec review: `APPROVED`.
- Standards review: `APPROVED`.

## Blocked by

- [Task 151](151-migrate-candidate-capture.md)
