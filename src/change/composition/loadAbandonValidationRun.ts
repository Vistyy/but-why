import { Effect } from "effect";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteValidationRunAbandonmentPort } from "../../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteExecutionLock } from "../../sqlite/sqliteExecutionLock.js";
import { type AbandonValidationRun, openAbandonValidationRun } from "../abandonValidationRun.js";
import { validationWorkspaceCleanupGit } from "../validation/validationWorkspaceCleanupGit.js";

export type LoadAbandonValidationRunResult =
  | { readonly ok: true; readonly abandon: AbandonValidationRun }
  | {
      readonly ok: false;
      readonly error:
        | ResolveLocalRepositoryError
        | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };
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
            workspaceCleanup: validationWorkspaceCleanupGit(context.mainCheckoutRoot),
          }).abandon(command),
        ).pipe(loaded.runtime.provide),
    },
  };
};
