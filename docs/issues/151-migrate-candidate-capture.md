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
- Baseline findings A4 and A5 belong to this task.

## What to build

Migrate Candidate and Candidate capture persistence to the Effect-native contract.

Move store and Git adapter construction to repository composition.
Keep validation history and delivery on their temporary storage paths until their migration tasks.

## Primary verification seam

Candidate capture integration tests create, reuse, reject, and roll back Candidates through the public Change capture behavior.

## Acceptance criteria

- [ ] Candidate and capture operations use Effect-native persistence.
- [ ] Candidate capture receives persistence and Git operations through narrow interfaces.
- [ ] Candidate reuse and repository identity behavior remain unchanged across processes and linked worktrees.
- [ ] Provenance conflicts and failed writes roll back the complete capture.
- [ ] Repository composition supplies Candidate capture persistence and Git operations.
- [ ] Baseline findings A4 and A5 are resolved.

## Blocked by

- [Task 150](150-migrate-task-and-change-start-storage.md)
