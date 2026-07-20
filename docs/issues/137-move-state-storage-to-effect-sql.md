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

## Scoped implementation record

- Baseline: `1396e3d688fccb0e0bba79f3f98b55bc729382c4`.
- Spec review source: this task draft.
- Normative traceability: `spikes/effect-first-path/README.md`, `docs/issues/036-establish-effect-adoption-baseline.md`, `docs/specs/taskless-changes-and-worktree-handoff.md`, and `docs/architecture.md`.
- Primary seam: a public CLI integration path that initializes fresh repository state, persists a Change workflow record, exits, and reads it from a later process.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Effect SQL versions are compatible with Effect `3.20.0`. | Root package manifest and lockfile. | Fresh install and CLI tests. | `just typecheck`; `just test`. |
| Fresh initialization applies one baseline. | Effect Migrator bootstrap and baseline migration. | Fresh CLI initialization. | Migration-ledger integration assertion. |
| Future changes use the same ledger and runner. | Shared migration runner in repository storage composition. | Fresh initialization plus ledger inspection. | Structural search and migration-ledger assertion. |
| Effect SQL replaces native SQLite without a parallel path. | Shared scoped SQL service and migrated stores. | Primary CLI seam. | `just quality` and structural search. |
| Every store uses the scoped Effect SQL service. | Repository-local store composition and store adapters. | Task and Change CLI workflows. | Typecheck and composition search. |
| Storage failures use precise typed Effect channels. | Storage error types and boundary mapping. | Identity, unavailable-state, malformed-state, and persistence failure tests. | Focused failure tests and typecheck. |
| Transactions preserve atomicity and rollback. | Store transaction boundaries using Effect SQL transactions. | Candidate capture, Change completion, and concurrent Task tests. | Focused transaction tests and full test suite. |
| Repository identity and linked-worktree sharing remain intact. | Git common-directory state path and identity initialization. | Shared-state and linked-worktree tests. | Focused shared-state tests. |
| Public Task and Change persistence remains unchanged. | Existing store interfaces and local use cases. | Existing Task and Change CLI tests. | Full test suite. |
| Native driver, synchronous session, and old runner are removed. | `src/init/stateDatabase.ts`, `src/sqlite/`, and callers. | Build and CLI tests. | Structural search for retired symbols. |
| No second driver, ledger, or composition path remains. | One Effect SQL adapter, migration ledger, and repository store graph. | Primary CLI seam. | Structural search and quality checks. |
| Direct Effect runtime execution remains at `src/main.ts`. | Effect program composition through executable boundary. | CLI process tests. | Structural search for runtime execution calls. |

Required validation commands:

```sh
just quality
cd spikes/effect-first-path && pnpm install && pnpm run typecheck && pnpm test
```

Direct structural verification must confirm that `node:sqlite`, `DatabaseSync`, `StateDatabaseSession`, `prepareStateDatabaseSession`, and `ensureStateDatabase` have no surviving implementation or test references, and that only one Effect SQL adapter, migration ledger, and repository-store composition remain.

## Implementation decision ledger

- Local: use the spike's pinned `@effect/sql@0.50.0`, `@effect/sql-sqlite-node@0.51.0`, and `better-sqlite3@12.11.1` with `effect@3.20.0`, because the approved spike verifies this combination.
- Local: keep `<git-common-dir>/but-why/state.sqlite` as the shared state path and preserve the existing repository identity contract, because `docs/architecture.md` and `CONTEXT.md` define shared state through Git's common directory.
- Local: preserve existing store interfaces and domain result unions while changing their implementation effect types, because the task requires public Task and Change persistence behavior to remain unchanged.
- Local: compose one scoped SQL service at the repository context boundary and provide it to every surviving store, because the spike requires scoped adapter cleanup and the task forbids duplicate storage composition.
- Local: use one named Effect Migrator baseline for the post-Task-107 schema and let Effect own its migration ledger, because the architecture permits one current baseline and the approved spike verifies the ledger behavior.
- Local: map SQL, migration, identity, unavailable-state, and persisted-JSON failures to repository-specific typed Effect errors while retaining domain rejection results, because the task requires precise storage failure channels and current public domain outcomes must remain stable.
- Local: validate transaction semantics through the existing atomicity and concurrency seams before claiming equivalence with the native implementation, because the spike verifies rollback but does not verify the application's `BEGIN IMMEDIATE` workload.

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
