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
- Baseline finding H6 belongs to this task.

## What to build

Expand repository storage with the shared Effect-native contract required by the migration slices.

Keep the synchronous path available for unmigrated callers.
Prove the new lifecycle and failure behavior through storage integration tests before migrating a domain workflow.

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

- [Task 148](148-establish-audited-quality-baseline.md)
