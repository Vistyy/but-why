import { existsSync } from "node:fs";
import { Effect } from "effect";

import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { createSqliteSnapshot } from "../sqlite/sqliteSnapshot.js";
import type {
  SharedRepositoryStateSnapshot,
  SnapshotCreationFailed,
  SnapshotUseCases,
} from "./snapshot.js";

export type LoadSnapshotUseCasesError = LoadRepoLocalContextError;

export type LoadedSnapshotUseCases =
  | { readonly ok: true; readonly useCases: SnapshotUseCases }
  | { readonly ok: false; readonly error: LoadSnapshotUseCasesError };

export const loadSnapshotUseCases = (cwd: string): Effect.Effect<LoadedSnapshotUseCases> => {
  const context = loadRepoLocalContext(cwd);
  if (!context.ok) return Effect.succeed(context);
  if (!existsSync(context.context.paths.statePath)) {
    return Effect.succeed({
      ok: false,
      error: {
        code: "state_store_unavailable" as const,
        taskPrefix: context.context.taskPrefix,
      },
    });
  }

  const input = {
    sourcePath: context.context.paths.statePath,
    snapshotsPath: context.context.paths.snapshotsPath,
  };
  const useCases: SnapshotUseCases = {
    create: (): Effect.Effect<SharedRepositoryStateSnapshot, SnapshotCreationFailed> =>
      createSqliteSnapshot(input),
  };
  return Effect.succeed({ ok: true, useCases });
};
