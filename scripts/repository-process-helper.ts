import { Effect } from "effect";

import {
  RepositorySql,
  repositorySqlLayer,
} from "../src/repositoryRuntime/adapters/sqlite/repositorySql.js";

const waitForStartSignal = (): Promise<void> =>
  new Promise((resolve) => {
    const keepAlive = setTimeout(() => {}, 3_000);
    process.on("SIGUSR2", () => {
      clearTimeout(keepAlive);
      resolve();
    });
    process.stdout.write("ready\n");
  });

const initializeState = async (statePath: string, commonDirectory: string): Promise<number> => {
  await waitForStartSignal();

  const program = Effect.gen(function* () {
    const repository = yield* RepositorySql;
    const migrations = yield* repository.operation(
      "read initialized migration ledger",
      (sql) => sql<{ readonly migrationId: number }>`
        SELECT migration_id AS migrationId
        FROM effect_sql_migrations
        ORDER BY migration_id
      `,
    );
    const identities = yield* repository.operation(
      "read initialized repository identity",
      (sql) => sql<{ readonly commonDirectory: string; readonly idPrefix: string }>`
        SELECT common_directory AS commonDirectory, id_prefix AS idPrefix
        FROM shared_state_identity
        WHERE id = 1
      `,
    );
    return {
      ok: true as const,
      migrations: migrations.map(({ migrationId }) => migrationId),
      identity: identities[0],
    };
  });

  const outcome = await Effect.runPromise(
    Effect.either(
      Effect.scoped(
        program.pipe(
          Effect.provide(
            repositorySqlLayer({
              statePath,
              commonDirectory,
              lifecycle: "initialize",
              migrationContentionTimeoutMs: 2_000,
              migrationContentionRetryDelayMs: 20,
            }),
          ),
        ),
      ),
    ),
  );

  if (outcome._tag === "Left") {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { _tag: outcome.left._tag } })}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(outcome.right)}\n`);
  return 0;
};

const [command, statePath, commonDirectory] = process.argv.slice(2);
if (command !== "initialize" || statePath === undefined || commonDirectory === undefined) {
  process.stderr.write(
    "Usage: repository-process-helper.ts initialize <statePath> <commonDirectory>\n",
  );
  process.exitCode = 2;
} else {
  process.exitCode = await initializeState(statePath, commonDirectory);
}
