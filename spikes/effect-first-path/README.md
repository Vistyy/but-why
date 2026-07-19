# Effect-first dependency path

## Decision

The Effect-first path is viable for But Why?.
Future implementation should converge on one Effect dependency graph rather than preserve explicit orchestration and native SQLite as parallel architectural defaults.

## Proven

The executable test uses versions compatible with the project's pinned Effect `3.20.0` runtime.
It proves that:

- `@effect/vitest` runs Effect tests with `TestClock`.
- `Effect.fn` names reusable operations.
- A Context service receives dependencies through a Layer.
- `Effect.timeoutOption` behaves deterministically under virtual time.
- `@effect/sql-sqlite-node` builds successfully on the supported Node environment.
- Effect Migrator creates a fresh SQLite database from one baseline migration.
- Parameterized reads and writes work against that database.
- Effect SQL commits successful transactions and rolls back failed transactions.
- Effect Migrator records the baseline in its single migration ledger.
- The scoped SQLite Layer closes cleanly.
- No mixed Effect runtime warning occurs.

Run the proof with:

```sh
cd spikes/effect-first-path
pnpm install
pnpm run typecheck
pnpm test
```

## Consequences

The official SQLite adapter uses `better-sqlite3` rather than Node's built-in `node:sqlite`.
Adoption therefore replaces the current driver instead of wrapping it.
Because no deployed database requires upgrade compatibility, production migration can replace the historical migration chain with one Effect Migrator baseline after obsolete Task-owned tables are removed.
Future schema changes then continue from that baseline through the same Effect migration ledger.

The prototype removes the technical uncertainty.
Porting the final application schema and dependencies remains implementation work.
