import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { type RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";

export const testRepositoryConfig = (root: string) => ({
  commonDirectory: join(root, ".git"),
  statePath: join(root, ".git", "but-why", "state.sqlite"),
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
          }),
        ),
      ),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );
