import { existsSync } from "node:fs";

import { Effect } from "effect";

import {
  openCandidateValidationRunInspection,
  type CandidateValidationRunInspectionUseCases,
} from "./inspectCandidateValidationRun.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../../init/repoContext.js";
import { repositorySqlLayer } from "../../sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../../sqlite/sqliteChangeValidationPersistence.js";

export type LoadCandidateValidationRunInspectionResult =
  | {
      readonly ok: true;
      readonly taskPrefix: string;
      readonly inspection: CandidateValidationRunInspectionUseCases;
    }
  | { readonly ok: false; readonly error: LoadRepoLocalContextError };

export const loadCandidateValidationRunInspection = (input: {
  readonly cwd: string;
}): LoadCandidateValidationRunInspectionResult => {
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
    persistence: openSqliteChangeValidationPersistence(),
    changePersistence: openSqliteChangePersistence(),
  }).pipe(
    Effect.map(({ persistence, changePersistence }) =>
      openCandidateValidationRunInspection({
        persistence,
        changePersistence,
        artifactsRoot: context.paths.artifactsPath,
      }),
    ),
  );
  return {
    ok: true,
    taskPrefix: context.taskPrefix,
    inspection: {
      inspectRun: (validationRunId) =>
        Effect.flatMap(inspectionFor, (inspection) => inspection.inspectRun(validationRunId)).pipe(
          Effect.provide(repositoryLayer),
        ),
      readArtifact: (validationRunId, artifactRef) =>
        Effect.flatMap(inspectionFor, (inspection) =>
          inspection.readArtifact(validationRunId, artifactRef),
        ).pipe(Effect.provide(repositoryLayer)),
    },
  };
};
