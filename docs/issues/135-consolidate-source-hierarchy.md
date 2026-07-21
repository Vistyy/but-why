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

## Acceptance criteria

- [ ] Every top-level `src/` folder has one documented domain owner or shared adapter role.
- [ ] Task-owned code covers Task intent and Task lifecycle.
- [ ] Change-owned code covers implementation, Candidates, submission, validation ownership, and delivery.
- [ ] Cross-domain workflows live under one primary owner and call other modules through their existing interfaces.
- [ ] CLI, persistence, repository, execution, and output adapters are grouped by clear shared roles.
- [ ] No migration-only folder or forwarding module remains.
- [ ] The reorganization does not redesign public or internal interfaces.
- [ ] The reorganization preserves public commands and persisted data.
- [ ] Public and domain-facing names use canonical project terms and remain precise search anchors.
- [ ] Imports, tests, structural checks, and architecture documentation describe the final hierarchy.
- [ ] The full repository suite passes after the move.

## Blocked by

- [Task 147](147-remove-synchronous-state-storage-path.md)
