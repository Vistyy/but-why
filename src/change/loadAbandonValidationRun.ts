import { existsSync } from "node:fs";

import { Effect } from "effect";
import { type LoadRepoLocalContextError, loadRepoLocalContext } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { type AbandonValidationRun, openAbandonValidationRun } from "./abandonValidationRun.js";
import {
  deleteDisposableTempRef,
  removeDisposableWorktree,
} from "../workspace/workspaceGit.js";
import { validationTempRefName } from "./validation/validationWorkspacePath.js";

export type LoadAbandonValidationRunResult =
  | { readonly ok: true; readonly abandon: AbandonValidationRun }
  | {
      readonly ok: false;
      readonly error:
        | LoadRepoLocalContextError
        | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };
    };

export const loadAbandonValidationRun = (input: {
  readonly cwd: string;
}): LoadAbandonValidationRunResult => {
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  const context = repoContext.context;
  if (!existsSync(context.paths.statePath)) {
    return {
      ok: false,
      error: { code: "state_store_unavailable", taskPrefix: context.taskPrefix },
    };
  }

  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });

  return {
    ok: true,
    abandon: {
      abandon: (command) =>
        Effect.flatMap(openSqliteChangeValidationPersistence(), (persistence) =>
          openAbandonValidationRun({
            persistence,
            executionLock: openSqliteExecutionLock({ commonDirectory: context.commonDirectory }),
            workspaceCleanup: {
              tempRefName: validationTempRefName,
              removeWorktree: (worktreePath) =>
                removeDisposableWorktree(context.mainCheckoutRoot, worktreePath),
              deleteTempRef: (tempRefName) =>
                deleteDisposableTempRef(context.mainCheckoutRoot, tempRefName),
            },
          }).abandon(command),
        ).pipe(Effect.provide(repositoryLayer)),
    },
  };
};
