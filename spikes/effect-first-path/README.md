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
- Effect SQL opens a database created by the current 23-migration path.
- Existing Task data survives the handoff from the current driver to Effect SQL.
- Parameterized reads and writes work against that database.
- Effect SQL commits successful transactions and rolls back failed transactions.
- The Effect SQL migrator applies and records a new migration beside the existing migration history.
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
The existing migration history uses multi-statement `DatabaseSync.exec` migrations and its own `schema_migrations` table.
Production migration must preserve upgrades for existing databases, establish an Effect SQL baseline for new databases, and then make Effect SQL the owner of future migrations.

The prototype removes the technical uncertainty.
Porting the application and migration history remains implementation work.
