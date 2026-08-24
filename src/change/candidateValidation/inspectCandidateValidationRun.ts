import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { CandidateRecord } from "../candidate/candidate.js";
import type { ChangeRecord } from "../change.js";
import type { ChangeReadPort } from "../changePorts.js";
import type { StallDetectionRecord } from "../stallDetection.js";
import type { ChangeValidationReadPort } from "../validation/changeValidationPorts.js";
import { readValidationArtifactContent } from "../validationRun/artifactContent.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type {
  CandidateValidationAgentInvocation,
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationPhaseResult,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "./candidateValidationRunStore.js";

const candidateValidationArtifactPreviewBytes = 1_000;

export type CandidateValidationArtifactRecord = CandidateValidationArtifact;

export type CandidateValidationRunInspection = {
  readonly validationRun: CandidateValidationRunRecord;
  readonly change: ChangeRecord;
  readonly candidate: CandidateRecord;
  readonly prepareResults: readonly CandidateValidationPhaseResult[];
  readonly checkResults: readonly CandidateValidationPhaseResult[];
  readonly acceptanceResults: readonly CandidateValidationPhaseResult[];
  readonly specialistResults: readonly CandidateValidationPhaseResult[];
  readonly findings: readonly CandidateValidationFinding[];
  readonly toolingFailures: readonly CandidateValidationToolingFailure[];
  readonly artifacts: readonly CandidateValidationArtifactInspection[];
  readonly agentInvocations: readonly CandidateValidationAgentInvocation[];
  readonly stallDetection: StallDetectionRecord | null;
};

export type CandidateValidationArtifactInspection = CandidateValidationArtifact & {
  readonly preview?: CandidateValidationArtifactPreview;
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

export type CandidateValidationRunInspectionUseCases<R = never> = {
  readonly inspectRun: (
    validationRunId: number,
  ) => Effect.Effect<CandidateValidationRunInspection | undefined, RepositoryStorageError, R>;
  readonly readArtifact: (
    validationRunId: number,
    artifactRef: string,
  ) => Effect.Effect<CandidateValidationArtifactContentResult, RepositoryStorageError, R>;
};

export const openCandidateValidationRunInspection = (input: {
  readonly persistence: ChangeValidationReadPort;
  readonly changePersistence: ChangeReadPort;
  readonly artifactsRoot: string;
  readonly getStallDetection: (
    validationRunId: number,
  ) => Effect.Effect<StallDetectionRecord | undefined, RepositoryStorageError>;
}): CandidateValidationRunInspectionUseCases<FileSystem.FileSystem> => ({
  inspectRun: (validationRunId) => inspectRun(input, validationRunId),
  readArtifact: (validationRunId, artifactRef) => readArtifact(input, validationRunId, artifactRef),
});

const inspectRun = (
  dependencies: {
    readonly persistence: ChangeValidationReadPort;
    readonly changePersistence: ChangeReadPort;
    readonly artifactsRoot: string;
    readonly getStallDetection: (
      validationRunId: number,
    ) => Effect.Effect<StallDetectionRecord | undefined, RepositoryStorageError>;
  },
  validationRunId: number,
): Effect.Effect<
  CandidateValidationRunInspection | undefined,
  RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const validationRun = yield* dependencies.persistence.getRunById(validationRunId);
    if (validationRun === undefined) return undefined;

    const candidate = yield* dependencies.persistence.getCandidateById(validationRun.candidateId);
    if (candidate === undefined) throw new Error("Candidate-owned Validation Run has no Candidate");
    const change = yield* dependencies.changePersistence.getChangeById(candidate.changeId);
    if (change === undefined) throw new Error("Candidate-owned Validation Run has no Change");
    const phaseResults = yield* dependencies.persistence.listPhaseResults(validationRunId);
    const findings = yield* dependencies.persistence.listFindings(validationRunId);
    const toolingFailures = yield* dependencies.persistence.listToolingFailures(validationRunId);
    const artifacts = yield* dependencies.persistence.listArtifacts(validationRunId);
    const agentInvocations = yield* dependencies.persistence.listAgentInvocations(validationRunId);
    const stallDetection = (yield* dependencies.getStallDetection(validationRunId)) ?? null;

    const findingArtifactRefs = new Set(findings.flatMap((finding) => finding.artifactRefs));
    const includeAllAvailablePreviews = toolingFailures.length > 0;

    const inspectedArtifacts = yield* Effect.forEach(artifacts, (artifact) => {
      const referencedByFinding = findingArtifactRefs.has(artifact.ref);
      if (!referencedByFinding && !includeAllAvailablePreviews) return Effect.succeed(artifact);

      return Effect.map(readPreview(dependencies.artifactsRoot, artifact), (preview) => ({
        ...artifact,
        ...(referencedByFinding || preview.status === "available" ? { preview } : {}),
      }));
    });

    return {
      validationRun,
      change,
      candidate,
      prepareResults: phaseResults.filter((result) => result.phase === validationPhase.prepare),
      checkResults: phaseResults.filter((result) => result.phase === validationPhase.checks),
      acceptanceResults: phaseResults.filter(
        (result) => result.phase === validationPhase.acceptanceReview,
      ),
      specialistResults: phaseResults.filter(
        (result) => result.phase === validationPhase.specialistReview,
      ),
      findings,
      toolingFailures,
      artifacts: inspectedArtifacts,
      agentInvocations,
      stallDetection,
    };
  });

const readArtifact = (
  dependencies: {
    readonly persistence: ChangeValidationReadPort;
    readonly artifactsRoot: string;
  },
  validationRunId: number,
  artifactRef: string,
): Effect.Effect<
  CandidateValidationArtifactContentResult,
  RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if ((yield* dependencies.persistence.getRunById(validationRunId)) === undefined) {
      return { ok: false, code: "validation_run_not_found" };
    }
    const artifact = (yield* dependencies.persistence.listArtifacts(validationRunId)).find(
      (candidate) => candidate.ref === artifactRef,
    );
    if (artifact === undefined) return { ok: false, code: "artifact_not_found" };

    const content = yield* readValidationArtifactContent(dependencies.artifactsRoot, artifact.path);
    return content === undefined
      ? { ok: false, code: "artifact_content_unavailable" }
      : { ok: true, artifact, content: content.toString("utf8") };
  });

const readPreview = (
  artifactsRoot: string,
  artifact: CandidateValidationArtifact,
): Effect.Effect<CandidateValidationArtifactPreview, never, FileSystem.FileSystem> =>
  Effect.map(readValidationArtifactContent(artifactsRoot, artifact.path), (content) => {
    if (content === undefined) return { status: "unavailable", reason: "content_unavailable" };

    const preview = content.subarray(0, candidateValidationArtifactPreviewBytes);
    return {
      status: "available",
      content: preview.toString("utf8"),
      bytes: preview.byteLength,
      storedBytes: artifact.storedBytes,
      truncated: content.byteLength > preview.byteLength,
    };
  });
