import { existsSync } from "node:fs";

import { Effect } from "effect";

import { openChangeInspection, type ChangeInspection } from "../change/inspectChange.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../sqlite/sqliteChangeValidationPersistence.js";

export type LoadChangeInspectionResult =
  | {
      readonly ok: true;
      readonly commonDirectory: string;
      readonly inspection: ChangeInspection;
    }
  | { readonly ok: false; readonly error: LoadRepoLocalContextError };

export const loadChangeInspection = (input: {
  readonly cwd: string;
}): LoadChangeInspectionResult => {
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  if (!existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  const context = repoContext.context;
  const stores = openRepoLocalStores(context);
  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });
  const inspectionFor = Effect.map(openSqliteChangeValidationPersistence(), (persistence) =>
    openChangeInspection({ changeStore: stores.changeStore, persistence }),
  );
  return {
    ok: true,
    commonDirectory: context.commonDirectory,
    inspection: {
      list: stores.changeStore.listChanges,
      inspectTaskProjection: (taskId) => {
        const change = stores.changeStore.getChangeByTaskId(taskId);
        return change === undefined
          ? null
          : { id: change.id, state: change.state, readiness: change.readiness };
      },
      inspect: (changeId) =>
        Effect.flatMap(inspectionFor, (inspection) => inspection.inspect(changeId)).pipe(
          Effect.provide(repositoryLayer),
        ),
      findings: (changeId) =>
        Effect.flatMap(inspectionFor, (inspection) => inspection.findings(changeId)).pipe(
          Effect.provide(repositoryLayer),
        ),
      validationRuns: (changeId) =>
        Effect.flatMap(inspectionFor, (inspection) => inspection.validationRuns(changeId)).pipe(
          Effect.provide(repositoryLayer),
        ),
    },
  };
};
