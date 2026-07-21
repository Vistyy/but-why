# Expand Effect-native storage

## Specification

- [Source specification decomposed from Task 146](146-migrate-state-stores-to-effect-programs.md)
- [Task 137 Effect SQL foundation](137-move-state-storage-to-effect-sql.md)
- [Effect-first storage spike](../../spikes/effect-first-path/README.md)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)

## Behaviors owned

- Repository storage exposes Effect-native operations beside the temporary synchronous contract.
- One scoped SQL service owns repository database acquisition, release, and migration lifecycle.
- Storage failures use tagged error channels for unavailable state, identity conflicts, SQL failures, migrations, and persisted data.
- Persisted string arrays round-trip through the current storage representation.
- Transactions roll back when an Effect-native operation fails.

## What to build

Expand repository storage with the shared Effect-native contract required by the migration slices.

Keep the synchronous path available for unmigrated callers.
Prove the new lifecycle and failure behavior through storage integration tests before migrating a domain workflow.

## Scoped implementation record

- Baseline: `31a563544e51afb6a655dc9b42a2b4e325034b87`.
- Spec review source: this task draft.
- Normative traceability: Task 146, Task 137, the Effect-first storage spike, ADR 0014, `docs/architecture.md`, and `docs/specs/taskless-changes-and-worktree-handoff.md`.
- Primary seam: `by init` acquires, migrates, closes, and reopens repository state through the scoped Effect storage lifecycle.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Scoped SQL lifecycle and migrations | Repository SQL composition and repository initialization | Repeated `by init` and scoped repository SQL integration | One baseline migration, identity validation, close, and reopen |
| Typed storage failures | Repository storage error contract and Effect SQL operation adapter | Repository SQL integration | Tagged unavailable-state, identity, SQL, migration, and persisted-data failures |
| Domain rejections remain successful values | Effect-native storage operation contract | Repository SQL transaction integration | Rejected domain result exits successfully while failed operations use the error channel |
| Persisted string arrays round-trip | SQLite string-array codec and persisted-data adapter | Codec and repository storage integration | Quotes, escapes, whitespace, empty arrays, and malformed input |
| Failed operations roll back | Effect SQL transaction boundary | Repository SQL transaction integration | Failed write leaves durable state unchanged |
| Synchronous callers remain available | Existing compatibility database and store callers | Existing full test suite | Existing behavior remains unchanged |

Required verification is `nix develop -c just quality` plus focused repository storage, initialization, and type-check commands during delivery.
The user approved the five Fallow boundary violations present at the baseline as an exception because later migration tasks own them.
Task 149 must introduce no additional quality failure.

## Implementation decision ledger

- User-approved: preserve the five baseline Fallow boundary violations while Task 149 introduces no new violation, because Tasks 150, 151, and 135 own the affected migration and consolidation work.
- Local: add one Effect-native repository SQL composition contract beside the synchronous compatibility contract, because Tasks 150 through 153 own domain workflow migration and Task 147 owns compatibility removal.
- Local: expose the scoped SQL client only to repository composition and SQLite adapters, while domain modules continue to receive narrow module-owned persistence interfaces required by ADR 0014.
- Local: use tagged errors named for unavailable state, repository identity conflict, SQL operations, migrations, and persisted data, with diagnostic operation or path fields and preserved causes where applicable.
- Local: treat the persisted string-array representation as strict JSON containing only strings, because the stored form is JSON and no normative source defines a wider grammar.

## Primary verification seam

`by init` acquires, migrates, closes, and reopens repository state through the scoped Effect storage lifecycle.
Focused storage integration tests additionally verify typed failures and rollback.

## Acceptance criteria

- [ ] One scoped SQL service owns repository database lifecycle and migrations.
- [ ] Effect-native storage operations return typed failures through the Effect error channel.
- [ ] Domain rejection results remain successful domain result values.
- [ ] Persisted string arrays round-trip quotes, escapes, whitespace, empty arrays, and malformed input as specified.
- [ ] Failed operations roll back without changing durable state.
- [ ] Existing synchronous callers and the full repository test suite continue to pass.

## Blocked by

None - can start immediately.
