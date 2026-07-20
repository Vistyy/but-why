# Effect-first dependency path

## Question

Can But Why? use one Effect dependency graph for orchestration and SQLite storage?

## Environment

The proof uses dependencies compatible with Effect `3.20.0` and the supported Node.js environment.
The SQLite adapter uses `better-sqlite3` instead of `node:sqlite`.

## Verified results

The proof verifies that:

- `@effect/vitest` runs Effect tests with `TestClock`.
- `Effect.fn` names reusable operations.
- A Context service receives dependencies through a Layer.
- `Effect.timeoutOption` behaves deterministically under virtual time.
- `@effect/sql-sqlite-node` builds successfully.
- Effect Migrator creates a fresh SQLite database from one baseline migration.
- Parameterized reads and writes work.
- Successful transactions commit.
- Failed transactions roll back.
- Effect Migrator records the baseline in one migration ledger.
- The scoped SQLite Layer closes cleanly.
- The proof produces no mixed Effect runtime warning.

Run the proof:

```sh
cd spikes/effect-first-path
pnpm install
pnpm run typecheck
pnpm test
```

All commands must pass.

## Consequences

Effect SQL adoption replaces the current SQLite driver instead of wrapping it.
Because no deployed database requires upgrade compatibility, Task 137 can replace historical migrations with one baseline after Task 107 removes obsolete tables.
Future schema changes must use the same Effect migration ledger.

## Remaining work

The proof does not port the application schema or application dependencies.
Task 137 owns that implementation work.
