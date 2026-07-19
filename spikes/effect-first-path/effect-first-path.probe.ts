import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { afterAll, expect, layer } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Option, TestClock } from "effect";
import { ensureStateDatabase } from "../../src/init/stateDatabase.js";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "but-why-effect-first-path-"));
const databasePath = join(temporaryDirectory, "state.sqlite");

ensureStateDatabase(databasePath, () => "2026-07-19T00:00:00.000Z");

const legacyDatabase = new DatabaseSync(databasePath);
try {
  legacyDatabase
    .prepare(
      `INSERT INTO tasks (
        id, numeric_id, title, description, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "BY-1",
      1,
      "Preserved task",
      "Existing state must survive the driver handoff.",
      "new",
      "2026-07-19T00:00:00.000Z",
      "2026-07-19T00:00:00.000Z",
    );
} finally {
  legacyDatabase.close();
}

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type ProbeResult = {
  readonly committedValue: string;
  readonly currentMigrationCount: number;
  readonly effectMigrationCount: number;
  readonly preservedTaskTitle: string;
  readonly rolledBackCount: number;
};

type StateProbeService = {
  readonly run: Effect.Effect<ProbeResult, unknown>;
  readonly delayedMigrationCount: Effect.Effect<number, unknown>;
};

class StateProbe extends Context.Tag("effect-first-path/StateProbe")<
  StateProbe,
  StateProbeService
>() {}

const StateProbeLive = Layer.effect(
  StateProbe,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const migrationCount = Effect.fn("StateProbe.migrationCount")(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM schema_migrations
      `;
      return rows[0]?.count ?? 0;
    });

    const run = Effect.fn("StateProbe.run")(function* () {
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({
          "1000_effect_first_path_probe": sql`
            CREATE TABLE effect_first_path_probe (
              value TEXT NOT NULL
            )
          `,
        }),
      }).pipe(Effect.provideService(SqlClient.SqlClient, sql));
      yield* sql`DELETE FROM effect_first_path_probe`;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO effect_first_path_probe (value)
            VALUES (${"rolled-back"})
          `;
          return yield* Effect.fail("deliberate rollback");
        }),
      ).pipe(Effect.either);

      const rolledBackRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_first_path_probe
        WHERE value = ${"rolled-back"}
      `;

      yield* sql.withTransaction(
        sql`
          INSERT INTO effect_first_path_probe (value)
          VALUES (${"committed"})
        `,
      );

      const committedRows = yield* sql<{ readonly value: string }>`
        SELECT value FROM effect_first_path_probe
      `;
      const effectMigrationRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM effect_sql_migrations
      `;
      const preservedTasks = yield* sql<{ readonly title: string }>`
        SELECT title FROM tasks WHERE id = ${"BY-1"}
      `;

      return {
        committedValue: committedRows[0]?.value ?? "missing",
        currentMigrationCount: yield* migrationCount(),
        effectMigrationCount: effectMigrationRows[0]?.count ?? 0,
        preservedTaskTitle: preservedTasks[0]?.title ?? "missing",
        rolledBackCount: rolledBackRows[0]?.count ?? -1,
      };
    });

    const delayedMigrationCount = Effect.sleep("10 seconds").pipe(
      Effect.andThen(migrationCount()),
    );

    return { run: run(), delayedMigrationCount };
  }),
);

const SqliteLive = SqliteClient.layer({
  filename: databasePath,
  disableWAL: true,
});

const AppLive = StateProbeLive.pipe(Layer.provide(SqliteLive));

layer(AppLive)("Effect-first dependency path", (it) => {
  it.effect("opens current state, commits, rolls back, and uses a named service", () =>
    Effect.gen(function* () {
      const probe = yield* StateProbe;
      const result = yield* probe.run;

      expect(result).toEqual({
        committedValue: "committed",
        currentMigrationCount: 23,
        effectMigrationCount: 1,
        preservedTaskTitle: "Preserved task",
        rolledBackCount: 0,
      });
    }),
  );

  it.effect("controls Effect-native timeout behavior with TestClock", () =>
    Effect.gen(function* () {
      const probe = yield* StateProbe;
      const fiber = yield* probe.delayedMigrationCount.pipe(
        Effect.timeoutOption("5 seconds"),
        Effect.fork,
      );

      yield* TestClock.adjust("5 seconds");
      const result = yield* Fiber.join(fiber);

      expect(Option.isNone(result)).toBe(true);
    }),
  );
});
