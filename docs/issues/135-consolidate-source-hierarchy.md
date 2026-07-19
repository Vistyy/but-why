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
Group workflow code under its owning domain and group genuinely shared code by its clear role.
Move files, update imports, tests, and architecture documentation without redesigning interfaces or changing public behavior.

## Primary verification seam

The full repository suite plus structural checks of the final source directory map and imports.

## Acceptance criteria

- [ ] Every top-level source folder has one documented domain owner or one clearly named shared role.
- [ ] Task-owned code covers Task intent and Task lifecycle.
- [ ] Change-owned code covers implementation, Candidates, submission, validation ownership, and delivery.
- [ ] Cross-domain workflows live under one primary owner and call other modules through their existing interfaces.
- [ ] CLI, persistence, repository, execution, and output adapters are grouped by clear shared roles.
- [ ] No migration-only folder or forwarding module remains.
- [ ] The reorganization does not add interfaces, alter command behavior, or change persisted behavior.
- [ ] Imports, tests, structural checks, and architecture documentation describe the final hierarchy.
- [ ] The full repository suite passes after the move.

## Blocked by

- `docs/issues/137-move-state-storage-to-effect-sql.md`
