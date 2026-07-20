# Move state storage to Effect SQL

## Specification

- `spikes/effect-first-path/README.md`
- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/architecture.md`

## Behaviors owned

- Fresh repository state uses Effect SQL storage through one Effect migration ledger.
- Every surviving store uses the same scoped Effect SQL dependency path.

## What to build

Replace the current native SQLite storage implementation with the Effect SQL SQLite adapter validated in `spikes/effect-first-path/README.md`.
Create one Effect Migrator baseline for the current schema established by Task 107, and use that migration path for future schema changes.
Migrate all surviving stores and remove the native driver, synchronous session, and duplicate storage composition.

## Primary verification seam

A public CLI integration path that initializes fresh repository state, persists a surviving Change workflow record, exits, and reads the same record through a later process.

## Acceptance criteria

- [ ] Effect SQL package versions are pinned to releases compatible with Effect `3.20.0`.
- [ ] Fresh initialization applies one Effect Migrator baseline containing the schema that remains after Task 107.
- [ ] Future schema changes use the same Effect migration ledger and runner.
- [ ] Effect SQL replaces the current native SQLite baseline without adding a parallel storage path.
- [ ] Every surviving store executes through the scoped Effect SQL service.
- [ ] Store boundaries map each storage failure category to a precise typed Effect error channel.
- [ ] Transactions preserve current atomicity and rollback behavior.
- [ ] Repository identity and linked-worktree state sharing remain intact.
- [ ] Public Task and Change persistence behavior remains unchanged.
- [ ] Native `node:sqlite`, the synchronous state session, and the old migration runner are removed.
- [ ] No second SQLite driver, migration ledger, or storage composition path remains.
- [ ] Direct Effect runtime execution remains limited to the executable boundary.

## Blocked by

- `docs/issues/107-remove-task-owned-validation.md`
