import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { afterAll, expect, layer } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Option, TestClock } from "effect";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "but-why-effect-first-path-"));
const databasePath = join(temporaryDirectory, "state.sqlite");

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type ProbeResult = {
  readonly committedValue: string;
  readonly effectMigrationCount: number;
  readonly taskTitle: string;
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

    const migrate = Migrator.make({})({
      loader: Migrator.fromRecord({
        "0001_baseline": Effect.gen(function* () {
          yield* sql`
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL
            )
          `;
          yield* sql`
            CREATE TABLE effect_first_path_probe (
              value TEXT NOT NULL
            )
          `;
        }),
      }),
    }).pipe(Effect.provideService(SqlClient.SqlClient, sql));

    const effectMigrationCount = Effect.fn("StateProbe.effectMigrationCount")(function* () {
      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM effect_sql_migrations
      `;
      return rows[0]?.count ?? 0;
    });

    const run = Effect.fn("StateProbe.run")(function* () {
      yield* migrate;
      yield* sql`DELETE FROM tasks`;
      yield* sql`DELETE FROM effect_first_path_probe`;
      yield* sql`
        INSERT INTO tasks (id, title)
        VALUES (${"BY-1"}, ${"Effect-owned task"})
      `;

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
      const tasks = yield* sql<{ readonly title: string }>`
        SELECT title FROM tasks WHERE id = ${"BY-1"}
      `;

      return {
        committedValue: committedRows[0]?.value ?? "missing",
        effectMigrationCount: yield* effectMigrationCount(),
        taskTitle: tasks[0]?.title ?? "missing",
        rolledBackCount: rolledBackRows[0]?.count ?? -1,
      };
    });

    const delayedMigrationCount = migrate.pipe(
      Effect.andThen(Effect.sleep("10 seconds")),
      Effect.andThen(effectMigrationCount()),
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
        effectMigrationCount: 1,
        taskTitle: "Effect-owned task",
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
