import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Stream } from "effect";
import { describe } from "vitest";

import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";

const withDatabase = <A, E>(use: Effect.Effect<A, E, SqlClient.SqlClient>) => {
  const root = mkdtempSync(join(tmpdir(), "but-why-node-sqlite-"));
  const path = join(root, "state.sqlite");
  return use.pipe(
    Effect.provide(nodeSqliteLayer(path)),
    Effect.scoped,
    Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
  );
};

describe("private Node SQLite SQL Adapter", () => {
  it.scoped("binds values and preserves rows, values, raw results, and errors", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)`;
        const inserted =
          yield* sql`INSERT INTO records (value) VALUES (${"one"}) RETURNING id, value`;
        expect(inserted).toEqual([{ id: 1, value: "one" }]);
        const values = yield* sql`SELECT id, value FROM records`.values;
        expect(values).toEqual([[1, "one"]]);
        const raw = yield* sql`INSERT INTO records (value) VALUES (${"two"})`.raw;
        expect(raw).toMatchObject({ changes: 1 });
        const failure = yield* sql`SELECT * FROM missing_records`.pipe(Effect.flip);
        expect(failure._tag).toBe("SqlError");
      }),
    ),
  );

  it.scoped("commits, rolls back, and nests transactions with savepoints", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE records (value TEXT)`;
        yield* sql.withTransaction(sql`INSERT INTO records VALUES ('committed')`);
        yield* sql
          .withTransaction(
            sql`INSERT INTO records VALUES ('rolled back')`.pipe(
              Effect.zipRight(Effect.fail("rollback")),
            ),
          )
          .pipe(Effect.flip);
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO records VALUES ('outer')`;
            yield* sql
              .withTransaction(
                sql`INSERT INTO records VALUES ("inner")`.pipe(
                  Effect.zipRight(Effect.fail("savepoint rollback")),
                ),
              )
              .pipe(Effect.flip);
          }),
        );
        const rows = yield* sql<{
          readonly value: string;
        }>`SELECT value FROM records ORDER BY rowid`;
        expect(rows.map((row) => row.value)).toEqual(["committed", "outer"]);
      }),
    ),
  );

  it.scoped("serializes concurrent access and closes in its scope", () => {
    const root = mkdtempSync(join(tmpdir(), "but-why-node-sqlite-"));
    const path = join(root, "state.sqlite");
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE records (value INTEGER)`;
        yield* Effect.all(
          Array.from({ length: 20 }, (_, value) => sql`INSERT INTO records VALUES (${value})`),
          { concurrency: "unbounded" },
        );
        const rows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM records`;
        expect(rows[0]?.count).toBe(20);
      }).pipe(Effect.provide(nodeSqliteLayer(path)), Effect.scoped);
      expect(existsSync(path)).toBe(true);
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))));
  });

  it.scoped("eagerly materializes the supported stream operation", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE records (value INTEGER)`;
        yield* sql`INSERT INTO records VALUES (1), (2)`;
        const rows = yield* Stream.runCollect(sql`SELECT value FROM records ORDER BY value`.stream);
        expect(Array.from(rows)).toEqual([[{ value: 1 }, { value: 2 }]]);
      }),
    ),
  );
});
