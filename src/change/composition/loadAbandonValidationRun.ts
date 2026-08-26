import { Effect } from "effect";
import { openSqliteExecutionLock } from "../../repositoryRuntime/adapters/sqlite/sqliteExecutionLock.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { type AbandonValidationRun, openAbandonValidationRun } from "../abandonValidationRun.js";
import { openSqliteValidationRunAbandonmentPort } from "../adapters/sqlite/sqliteValidationRunAbandonmentPersistence.js";
import { snapshotWorkspaceCleanupGit } from "../validation/adapters/snapshotWorkspaceCleanupGit.js";

export type LoadAbandonValidationRunResult =
  | { readonly ok: true; readonly abandon: AbandonValidationRun }
  | {
      readonly ok: false;
      readonly error:
        | ResolveLocalRepositoryError
        | { readonly code: "state_store_unavailable"; readonly idPrefix: string };
    };

export const loadAbandonValidationRun = (input: {
  readonly cwd: string;
}): LoadAbandonValidationRunResult => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return loaded;
  const { context } = loaded.runtime;

  return {
    ok: true,
    abandon: {
      abandon: (command) =>
        Effect.flatMap(openSqliteValidationRunAbandonmentPort(), (persistence) =>
          openAbandonValidationRun({
            persistence,
            executionLock: openSqliteExecutionLock({ commonDirectory: context.commonDirectory }),
            workspaceCleanup: snapshotWorkspaceCleanupGit(context.root, context.commonDirectory),
          }).abandon(command),
        ).pipe(loaded.runtime.provide),
    },
  };
};
