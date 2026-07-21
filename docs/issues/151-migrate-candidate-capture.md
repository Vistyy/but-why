# Migrate Candidate capture

## Specification

- [Source specification decomposed from Task 146](146-migrate-state-stores-to-effect-programs.md)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)
- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)

## Behaviors owned

- A Change worktree produces a persisted Candidate through Effect-native storage.
- Candidate capture receives only the Change persistence and Git operations it requires.
- Candidate identity, base commit, head commit, repository identity, and Change ownership remain durable.
- Existing Candidate reuse, branch movement, provenance conflicts, and rollback behavior remain unchanged.

## What to build

Migrate Candidate and Candidate capture persistence to the Effect-native contract.

Move store and Git adapter construction to repository composition.
Keep validation history and delivery on their temporary storage paths until their migration tasks.

## Scoped implementation record

- Baseline: `22e0583577d429b358fa85780539d9b5f76cd8a7`.
- Spec review source: this task draft.
- Normative traceability: Task 146, ADR 0014, `docs/architecture.md`, the Effect-first storage spike, and `docs/specs/taskless-changes-and-worktree-handoff.md`.
- Primary seam: Candidate capture integration tests create, reuse, reject, and roll back Candidates through the public Change capture behavior.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Candidate and capture operations use Effect-native persistence | Candidate capture persistence interface and SQLite adapter | Candidate capture and repository storage integration | Candidate creation and reuse run through repository SQL Effects |
| Capture receives narrow persistence and Git operations | Candidate capture workflow interfaces | Candidate capture orchestration test | Supplied interfaces provide every persisted and Git fact |
| Candidate reuse and repository identity remain unchanged | Candidate capture workflow and repository SQL composition | Real-Git linked-worktree and repository identity integration | Exact Candidate reuse, shared repository state, and typed identity conflict |
| Conflicts and failed writes roll back complete capture | Candidate capture transaction | Provenance conflict and failed-write storage integration | Change binding, base assignment, and Candidate rows remain unchanged |
| Repository composition supplies capture dependencies | Change Submit repository composition | Change Submit CLI and orchestration integration | Production submission captures through composed SQLite and local Git adapters |

Required verification is `nix develop -c just quality` plus focused Candidate capture, Change Submit, repository storage, type-check, lint, formatting, ast-grep, and Fallow commands during delivery.
The baseline quality gate passes all tests and static checks before remaining nonzero on four Task-149-approved Fallow boundary violations.
Task 151 must remove its two Candidate capture violations and introduce no new quality failure.

## Implementation decision ledger

- Local: keep Candidate capture domain rejections as successful Effect values and propagate repository storage failures through the typed error channel, matching Tasks 146 and 149.
- Local: give Candidate capture separate workflow-owned persistence and Git interfaces, while repository composition selects the SQLite and local Git adapters required by ADR 0014.
- Local: keep Change selection, rebinding, base assignment, Candidate reuse, and Candidate insertion in the named Candidate capture persistence module, with the durable write set inside `RepositorySql.transactionImmediate`.
- Local: preserve Git-visible rejection checks before persistence acquisition in the public integration seam, so unsafe worktrees do not create repository state.
- Deferred to Task 152: migrate Candidate reads used by validation history from their temporary synchronous storage path.
- Deferred to Task 153: migrate Candidate reads used by publication and the remaining Change delivery lifecycle from their temporary synchronous storage path.
- User-approved, deferred to Task 153: preserve the two pre-existing Fallow boundary violations for reconciliation cleanup and GitHub target detection during this migration stage.

## Primary verification seam

Candidate capture integration tests create, reuse, reject, and roll back Candidates through the public Change capture behavior.

## Acceptance criteria

- [ ] Candidate and capture operations use Effect-native persistence.
- [ ] Candidate capture receives persistence and Git operations through narrow interfaces.
- [ ] Candidate reuse and repository identity behavior remain unchanged across processes and linked worktrees.
- [ ] Provenance conflicts and failed writes roll back the complete capture.
- [ ] Repository composition supplies Candidate capture persistence and Git operations.

## Blocked by

- [Task 149](149-expand-effect-native-storage.md)
