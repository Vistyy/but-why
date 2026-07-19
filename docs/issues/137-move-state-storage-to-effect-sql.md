# Move state storage to Effect SQL

## Specification

- `spikes/effect-first-path/README.md`
- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/architecture.md`

## Behaviors owned

- `spikes/effect-first-path/README.md`: Fresh repository state is created and evolved through one Effect SQL migration ledger.
- `docs/issues/036-establish-effect-adoption-baseline.md`: Every surviving store uses the same scoped Effect SQL dependency path.
- `spikes/effect-first-path/README.md`: Historical development migration compatibility is replaced by one baseline for the final v1 schema.

## What to build

After obsolete Task-owned storage is removed, replace native SQLite storage with the proven Effect SQL SQLite adapter.
Flatten the historical migration chain into one Effect Migrator baseline for the surviving schema and use that migration path for every future schema change.
Migrate all surviving stores and remove the old driver, migration runner, synchronous session, and duplicate storage composition.

## Primary verification seam

A public CLI integration path that initializes fresh repository state, persists a surviving Change workflow record, exits, and reads the same record through a later process.

## Acceptance criteria

- [ ] Effect SQL package versions are pinned to releases compatible with Effect `3.20.0`.
- [ ] Fresh initialization applies one Effect Migrator baseline containing the final surviving schema.
- [ ] Future schema changes use the same Effect migration ledger and runner.
- [ ] The historical migration chain and its upgrade-only tests are removed.
- [ ] Every surviving store executes through the scoped Effect SQL service.
- [ ] Store failures use precise Effect error channels at the storage seam.
- [ ] Transactions preserve current atomicity and rollback behavior.
- [ ] Repository identity and linked-worktree state sharing remain intact.
- [ ] Public Task and Change persistence behavior remains unchanged.
- [ ] Native `node:sqlite`, the synchronous state session, and the old migration runner are removed.
- [ ] No second SQLite driver, migration ledger, or storage composition path remains.
- [ ] Direct Effect runtime execution remains limited to the executable boundary.

## Blocked by

- `docs/issues/107-remove-task-owned-validation.md`
