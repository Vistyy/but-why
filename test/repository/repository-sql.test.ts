import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
} from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { withTemporaryRepositoryState as withTemporaryState } from "../support/repository.js";

describe("RepositorySql", () => {
  it.scoped("keeps domain rejections successful and rolls back failed operations", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        yield* repositorySql.operation(
          "create transaction probe",
          (sql) => sql`
            CREATE TABLE transaction_probe (value TEXT NOT NULL)
          `,
        );

        const rejection = { ok: false as const, code: "identity_conflict" as const };
        const rejectionResult = yield* repositorySql.transaction("preserve domain rejection", () =>
          Effect.succeed(rejection),
        );

        expect(rejectionResult).toEqual(rejection);

        yield* repositorySql
          .transaction("roll back failed write", (sql) =>
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO transaction_probe (value) VALUES (${"rolled back"})
              `;
              return yield* new RepositoryPersistedDataInvalid({
                operationName: "decode transaction probe",
                cause: new Error("deliberate persisted-data failure"),
              });
            }),
          )
          .pipe(Effect.flip);

        const rows = yield* repositorySql.operation(
          "read transaction probe",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM transaction_probe
          `,
        );
        expect(rows).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.scoped("reports malformed persisted string arrays through the typed error channel", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const error = yield* repositorySql
          .decodeStringArray("read Finding files", '["file.ts",]')
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({
          _tag: "RepositoryPersistedDataInvalid",
          operationName: "read Finding files",
        });
      }),
    ),
  );

  it.scoped("reports SQL operation failures through the typed error channel", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const error = yield* repositorySql
          .operation("read missing storage", (sql) => sql`SELECT * FROM missing_table`)
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositorySqlOperationFailed);
        expect(error).toMatchObject({
          _tag: "RepositorySqlOperationFailed",
          operationName: "read missing storage",
        });
      }),
    ),
  );
});
