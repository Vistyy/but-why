import { Effect } from "effect";

import type { CandidateRecord } from "../candidate/candidate.js";
import type { ChangeRecord } from "../change/change.js";
import type { ChangePersistence } from "../change/changePersistence.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "./candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "../changeValidation/changeValidationPersistence.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import { readValidationArtifactContent } from "../validationRun/artifactContent.js";
import { validationPhase } from "../validationRun/validationRun.js";

const candidateValidationArtifactPreviewBytes = 1_000;

export type CandidateValidationArtifactRecord = CandidateValidationArtifact;

export type CandidateValidationRunInspection = {
  readonly validationRun: CandidateValidationRunRecord;
  readonly change: ChangeRecord;
  readonly candidate: CandidateRecord;
  readonly prepareRounds: readonly CandidateValidationRound[];
  readonly checkRounds: readonly CandidateValidationRound[];
  readonly acceptanceRounds: readonly CandidateValidationRound[];
  readonly specialistRounds: readonly CandidateValidationRound[];
  readonly findings: readonly CandidateValidationFinding[];
  readonly toolingFailures: readonly CandidateValidationToolingFailure[];
  readonly artifacts: readonly CandidateValidationArtifactInspection[];
};

export type CandidateValidationArtifactInspection = CandidateValidationArtifact & {
  readonly preview: CandidateValidationArtifactPreview;
};

export type CandidateValidationArtifactPreview =
  | {
      readonly status: "available";
      readonly content: string;
      readonly bytes: number;
      readonly storedBytes: number;
      readonly truncated: boolean;
    }
  | { readonly status: "unavailable"; readonly reason: "content_unavailable" };

export type CandidateValidationArtifactContentResult =
  | {
      readonly ok: true;
      readonly artifact: CandidateValidationArtifact;
      readonly content: string;
    }
  | { readonly ok: false; readonly code: "validation_run_not_found" }
  | { readonly ok: false; readonly code: "artifact_not_found" }
  | { readonly ok: false; readonly code: "artifact_content_unavailable" };

export type CandidateValidationRunInspectionUseCases = {
  readonly inspectRun: (
    validationRunId: string,
  ) => Effect.Effect<CandidateValidationRunInspection | undefined, RepositoryStorageError>;
  readonly readArtifact: (
    validationRunId: string,
    artifactRef: string,
  ) => Effect.Effect<CandidateValidationArtifactContentResult, RepositoryStorageError>;
};

export const openCandidateValidationRunInspection = (input: {
  readonly persistence: ChangeValidationPersistence;
  readonly changePersistence: ChangePersistence;
  readonly artifactsRoot: string;
}): CandidateValidationRunInspectionUseCases => ({
  inspectRun: (validationRunId) => inspectRun(input, validationRunId),
  readArtifact: (validationRunId, artifactRef) => readArtifact(input, validationRunId, artifactRef),
});

const inspectRun = (
  dependencies: {
    readonly persistence: ChangeValidationPersistence;
    readonly changePersistence: ChangePersistence;
    readonly artifactsRoot: string;
  },
  validationRunId: string,
): Effect.Effect<CandidateValidationRunInspection | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const validationRun = yield* dependencies.persistence.getRunById(validationRunId);
    if (validationRun === undefined) return undefined;

    const candidate = yield* dependencies.persistence.getCandidateById(validationRun.candidateId);
    if (candidate === undefined) throw new Error("Candidate-owned Validation Run has no Candidate");
    const change = yield* dependencies.changePersistence.getChangeById(candidate.changeId);
    if (change === undefined) throw new Error("Candidate-owned Validation Run has no Change");
    const rounds = yield* dependencies.persistence.listRounds(validationRunId);
    const findings = yield* dependencies.persistence.listFindings(validationRunId);
    const toolingFailures = yield* dependencies.persistence.listToolingFailures(validationRunId);
    const artifacts = yield* dependencies.persistence.listArtifacts(validationRunId);

    return {
      validationRun,
      change,
      candidate,
      prepareRounds: rounds.filter((round) => round.phase === validationPhase.prepare),
      checkRounds: rounds.filter((round) => round.phase === validationPhase.checks),
      acceptanceRounds: rounds.filter((round) => round.phase === validationPhase.acceptanceReview),
      specialistRounds: rounds.filter((round) => round.phase === validationPhase.specialistReview),
      findings,
      toolingFailures,
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        preview: readPreview(dependencies.artifactsRoot, artifact),
      })),
    };
  });

const readArtifact = (
  dependencies: {
    readonly persistence: ChangeValidationPersistence;
    readonly artifactsRoot: string;
  },
  validationRunId: string,
  artifactRef: string,
): Effect.Effect<CandidateValidationArtifactContentResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if ((yield* dependencies.persistence.getRunById(validationRunId)) === undefined) {
      return { ok: false, code: "validation_run_not_found" };
    }
    const artifact = (yield* dependencies.persistence.listArtifacts(validationRunId)).find(
      (candidate) => candidate.ref === artifactRef,
    );
    if (artifact === undefined) return { ok: false, code: "artifact_not_found" };

    const content = readValidationArtifactContent(dependencies.artifactsRoot, artifact.path);
    return content === undefined
      ? { ok: false, code: "artifact_content_unavailable" }
      : { ok: true, artifact, content: content.toString("utf8") };
  });

const readPreview = (
  artifactsRoot: string,
  artifact: CandidateValidationArtifact,
): CandidateValidationArtifactPreview => {
  const content = readValidationArtifactContent(artifactsRoot, artifact.path);
  if (content === undefined) return { status: "unavailable", reason: "content_unavailable" };

  const preview = content.subarray(0, candidateValidationArtifactPreviewBytes);
  return {
    status: "available",
    content: preview.toString("utf8"),
    bytes: preview.byteLength,
    storedBytes: artifact.storedBytes,
    truncated: content.byteLength > preview.byteLength,
  };
};
