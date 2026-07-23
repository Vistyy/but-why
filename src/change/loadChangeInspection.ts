import { existsSync } from "node:fs";

import { Effect } from "effect";

import { openChangeInspection, type ChangeInspection } from "./inspectChange.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../sqlite/sqliteChangePersistence.js";
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
  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });
  const inspectionFor = Effect.all({
    changePersistence: openSqliteChangePersistence(),
    persistence: openSqliteChangeValidationPersistence(),
  }).pipe(Effect.map(openChangeInspection));
  const run = <A, E>(use: (inspection: ChangeInspection) => Effect.Effect<A, E>) =>
    Effect.flatMap(inspectionFor, use).pipe(Effect.provide(repositoryLayer));

  return {
    ok: true,
    commonDirectory: context.commonDirectory,
    inspection: {
      list: (listInput) => run((inspection) => inspection.list(listInput)),
      inspectTaskProjection: (taskId) =>
        run((inspection) => inspection.inspectTaskProjection(taskId)),
      inspect: (changeId) => run((inspection) => inspection.inspect(changeId)),
      findings: (changeId) => run((inspection) => inspection.findings(changeId)),
      validationRuns: (changeId) => run((inspection) => inspection.validationRuns(changeId)),
    },
  };
};
