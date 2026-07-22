# Remove the synchronous state storage path

## Specification

- `docs/issues/137-move-state-storage-to-effect-sql.md`
- `docs/issues/146-migrate-state-stores-to-effect-programs.md`
- `spikes/effect-first-path/README.md`
- `docs/architecture.md`

## Behaviors owned

- The Effect SQL storage path is the only production storage path.
- Direct Effect runtime execution remains limited to `src/main.ts`.
- Repository storage composition has one adapter, one migration ledger, and one scoped service.
- Structural and quality verification proves that the replaced path is removed.

## What to build

Remove `StateDatabase.runSync`, `StateDatabase.withConnection`, `ManagedRuntime` construction from repository storage, and the synchronous SQLite connection façade.

Remove duplicate migration and store composition after Tasks 149 through 153 migrate every production caller to the Effect-native contract.

Move any remaining Effect runtime execution to the executable boundary in `src/main.ts`.

Remove retired native SQLite, synchronous session, and migration-runner symbols from implementation and tests.

## Primary verification seam

Run the complete cross-process CLI workflow through initialization, Task-backed Change persistence, later inspection, and final validation.

## Scoped implementation record

- Baseline: `6ee5f92c0398f911f1a54f2c1aad3506ecb31bc9`.
- Spec review source: this task draft.
- Normative traceability: Tasks 137 and 146, `spikes/effect-first-path/README.md`, and `docs/architecture.md`.
- Primary seam: the complete cross-process CLI workflow through initialization, Task-backed Change persistence, later inspection, and final validation.

## Acceptance criteria

- [ ] `StateDatabase.runSync` and `StateDatabase.withConnection` no longer exist.
- [ ] The synchronous `SqliteDatabase` and `withStateDatabase` façade no longer exist.
- [ ] Repository storage does not construct a `ManagedRuntime`.
- [ ] Only `src/main.ts` executes the Effect runtime.
- [ ] No application source or test imports `node:sqlite` or constructs `DatabaseSync`.
- [ ] No application source directly depends on or imports `better-sqlite3`.
- [ ] One Effect SQL adapter, one migration ledger, and one repository storage composition remain.
- [ ] Every `just quality` stage passes except the Fallow health findings owned by Tasks 154, 155, and 157.
- [ ] The Effect-first spike typecheck and tests pass.
- [ ] The full test suite passes with no known failures.

## Implementation decision ledger

- Local: move the single Effect Migrator baseline to `src/sqlite/repositoryMigrations.ts` because repository migration ownership remains separate from repository SQL composition.
- Local: let each repository SQL Layer own its scoped SQLite lifetime because the synchronous process-wide database registry is retired.
- Local: initialize synchronous test repositories through the executable CLI and use `@effect/vitest` for in-process Effect execution.
- User-approved: permit the existing Fallow health findings owned by Tasks 154, 155, and 157 because those independently approved tasks remain nonblocking in `docs/issue-breakdown.md`.

## Blocked by

- [Task 153](153-migrate-submit-publication-and-reconciliation.md)
