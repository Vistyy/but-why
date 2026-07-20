# Establish the Effect SQL state baseline

## Specification

- `spikes/effect-first-path/README.md`
- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/architecture.md`

The remaining store migration requirements from this specification continue in:

- `docs/issues/146-migrate-state-stores-to-effect-programs.md`
- `docs/issues/147-remove-synchronous-state-storage-path.md`

## Behaviors owned

- Fresh repository state uses the pinned Effect SQL SQLite adapter.
- Fresh repository state applies one named Effect Migrator baseline.
- Shared repository identity remains stored at the Git common-directory state path.
- Existing CLI persistence behavior remains available while the later migration tasks move callers to the new storage contract.

## What to build

Use the Effect SQL SQLite adapter validated by `spikes/effect-first-path/README.md`.

Create one Effect Migrator baseline for the schema established by Task 107.

Use the baseline runner's `effect_sql_migrations` ledger for the initial schema.

Keep `<git-common-dir>/but-why/state.sqlite` as the shared state path.

Preserve shared repository identity validation and the current public Task and Change behavior during the expand stage.

This task establishes the storage foundation.
It does not claim completion of the store contract migration or removal of the temporary compatibility path.
Those behaviors belong to Tasks 146 and 147.

The temporary compatibility database is process-scoped and exposes explicit `close` ownership for callers that need to end the process-scoped lifetime.
Task 147 removes this compatibility lifetime with the synchronous storage path.

## Scoped implementation record

- Baseline: `1396e3d688fccb0e0bba79f3f98b55bc729382c4`.
- Spec review source: this task draft.
- Normative traceability: `spikes/effect-first-path/README.md`, `docs/issues/036-establish-effect-adoption-baseline.md`, `docs/specs/taskless-changes-and-worktree-handoff.md`, and `docs/architecture.md`.
- Primary seam: a public CLI integration path that initializes fresh repository state, persists state, exits, and reads the same state through a later process.

## Acceptance criteria

- [x] `@effect/sql@0.50.0` and `@effect/sql-sqlite-node@0.51.0` remain pinned with `effect@3.20.0`.
- [x] The application does not list or import `better-sqlite3` directly.
- [x] Fresh initialization creates the post-Task-107 schema through the Effect Migrator migration key `0001_baseline`.
- [x] Fresh initialization records exactly one row with `migration_id = 1` and `name = 'baseline'` in `effect_sql_migrations`.
- [x] Repeated initialization reuses the same migration ledger and does not create a second baseline.
- [x] State remains at `<git-common-dir>/but-why/state.sqlite`.
- [x] Shared repository identity remains rejected when state belongs to another Git repository.
- [x] Linked worktrees continue to share the same initialized state.
- [x] Existing Task and Change persistence tests pass during the expand stage.
- [x] The implementation decision ledger describes `better-sqlite3` as an adapter-owned transitive dependency.

## Implementation decision ledger

- Local: use the spike's pinned `@effect/sql@0.50.0` and `@effect/sql-sqlite-node@0.51.0` with `effect@3.20.0`, because the approved spike verifies this combination.
- Local: treat `better-sqlite3` as an adapter-owned transitive dependency, because the application must not list or import the native driver directly.
- Local: keep `<git-common-dir>/but-why/state.sqlite` as the shared state path and preserve the existing repository identity contract.
- Local: use one named Effect Migrator baseline for the post-Task-107 schema and let Effect own its migration ledger.
- Local: preserve current store behavior during this expand stage while Tasks 146 and 147 migrate and remove the temporary compatibility path.

## Primary verification seam

A public CLI integration path that initializes fresh repository state, persists state, exits, and reads the same state through a later process.

The migration-ledger test must inspect `migration_id` and `name` in `effect_sql_migrations`.

## Completion evidence

- `just quality` passed with 344 tests passing and one intentionally skipped.
- `cd spikes/effect-first-path && pnpm install --frozen-lockfile && pnpm run typecheck && pnpm test` passed.
- The migration ledger integration tests passed for fresh and repeated initialization.
- The Spec Reviewer returned `APPROVED`.
- The Standards Reviewer returned `APPROVED` with no findings.

## Blocked by

- `docs/issues/107-remove-task-owned-validation.md`

## Follow-up tasks

- Task 146 migrates every store and caller to the Effect-native storage contract.
- Task 147 removes the temporary synchronous path and performs final structural verification.
