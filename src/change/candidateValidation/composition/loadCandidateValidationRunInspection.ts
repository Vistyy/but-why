import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import type { ResolveLocalRepositoryError } from "../../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteChangeReadPort } from "../../../sqlite/sqliteChangeInspectionPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../../sqlite/sqliteChangeValidationReadPersistence.js";
import {
  type CandidateValidationRunInspectionUseCases,
  openCandidateValidationRunInspection,
} from "../inspectCandidateValidationRun.js";

export type LoadCandidateValidationRunInspectionResult =
  | {
      readonly ok: true;
      readonly idPrefix: string;
      readonly inspection: CandidateValidationRunInspectionUseCases;
    }
  | { readonly ok: false; readonly error: ResolveLocalRepositoryError };

export const loadCandidateValidationRunInspection = (input: {
  readonly cwd: string;
  readonly operationalRepoRoot?: string;
}): LoadCandidateValidationRunInspectionResult => {
  const loaded = openRepositoryRuntime(input.cwd, input.operationalRepoRoot);
  if (!loaded.ok) return loaded;
  const { context } = loaded.runtime;
  const inspectionFor = Effect.all({
    persistence: openSqliteChangeValidationReadPort(),
    changePersistence: openSqliteChangeReadPort(),
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
    idPrefix: context.idPrefix,
    inspection: {
      inspectRun: (validationRunId) =>
        loaded.runtime.provide(
          Effect.flatMap(inspectionFor, (inspection) =>
            inspection.inspectRun(validationRunId),
          ).pipe(Effect.provide(NodeFileSystem.layer)),
        ),
      readArtifact: (validationRunId, artifactRef) =>
        Effect.flatMap(inspectionFor, (inspection) =>
          inspection.readArtifact(validationRunId, artifactRef),
        ).pipe(Effect.provide(NodeFileSystem.layer), loaded.runtime.provide),
    },
  };
};
