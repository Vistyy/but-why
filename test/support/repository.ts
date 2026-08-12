import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import type { TaskState } from "../../src/task/lifecycle.js";
import type { PublicTaskId } from "../../src/task/taskId.js";

export const setTaskStateFixture = (
  taskId: PublicTaskId,
  state: TaskState,
  updatedAt: string,
  cancelReason: string | null = state === "cancelled" ? "Cancelled fixture" : null,
) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.operation(
      "set Task fixture state",
      (sql) => sql`
        UPDATE tasks
        SET state = ${state}, cancel_reason = ${cancelReason}, updated_at = ${updatedAt}
        WHERE id = ${taskId}
      `,
    ),
  );

export const testRepositoryConfig = (root: string) => ({
  commonDirectory: join(root, ".git"),
  statePath: join(root, ".git", "but-why", "state.sqlite"),
  lifecycle: "initialize" as const,
});

export const withTestRepository = <A, E, R>(
  root: string,
  program: Effect.Effect<A, E, RepositorySql | R>,
) => Effect.scoped(program.pipe(Effect.provide(repositorySqlLayer(testRepositoryConfig(root)))));

export const withTemporaryRepositoryState = <A, E>(
  use: (input: {
    readonly commonDirectory: string;
    readonly statePath: string;
  }) => Effect.Effect<A, E, RepositorySql>,
): Effect.Effect<A, E | RepositoryStorageError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
    (directory) =>
      use({
        commonDirectory: directory,
        statePath: join(directory, "state.sqlite"),
      }).pipe(
        Effect.provide(
          repositorySqlLayer({
            commonDirectory: directory,
            statePath: join(directory, "state.sqlite"),
            lifecycle: "initialize",
          }),
        ),
      ),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );
