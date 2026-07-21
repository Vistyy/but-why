# Migrate validation execution and history

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

## Primary verification seam

Candidate validation runs through Prepare, Checks, Acceptance Review, and Specialist Review, then the Findings and Validation Run commands return the complete persisted evidence.

## Acceptance criteria

- [ ] Validation execution and inspection use Effect-native persistence.
- [ ] Findings preserve optional severity, files, Artifact references, producer, phase, and recheck relationships.
- [ ] Command completion and Artifact creation use one verified behavior across Prepare and Checks.
- [ ] Acceptance and Specialist Review share Candidate integrity handling without losing phase-specific diagnostics.
- [ ] Every Tooling Failure variant has stable persisted and displayed output coverage.
- [ ] Existing-worktree preparation and cleanup outcomes are covered.

## Blocked by

- [Task 151](151-migrate-candidate-capture.md)
