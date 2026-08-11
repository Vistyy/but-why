import { Effect } from "effect";

import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { RepositorySql } from "../../sqlite/repositorySql.js";
import { createSqliteSnapshot } from "../../sqlite/sqliteSnapshot.js";
import {
  type SharedRepositoryStateSnapshot,
  SnapshotCreationFailed,
  type SnapshotUseCases,
} from "../snapshot.js";

export type LoadSnapshotUseCasesError = ResolveLocalRepositoryError;

export type LoadedSnapshotUseCases =
  | { readonly ok: true; readonly useCases: SnapshotUseCases }
  | { readonly ok: false; readonly error: LoadSnapshotUseCasesError };

export const loadSnapshotUseCases = (cwd: string): Effect.Effect<LoadedSnapshotUseCases> => {
  const loaded = openRepositoryRuntime(cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const { context } = loaded.runtime;

  const input = {
    sourcePath: context.paths.statePath,
    snapshotsPath: context.paths.snapshotsPath,
  };
  const useCases: SnapshotUseCases = {
    create: (): Effect.Effect<SharedRepositoryStateSnapshot, SnapshotCreationFailed> =>
      loaded.runtime
        .provide(Effect.zipRight(RepositorySql, createSqliteSnapshot(input)))
        .pipe(
          Effect.mapError((error) =>
            error instanceof SnapshotCreationFailed
              ? error
              : new SnapshotCreationFailed({ cause: error }),
          ),
        ),
  };
  return Effect.succeed({ ok: true, useCases });
};
