import type { CandidateRecord } from "../candidate/candidate.js";
import type { CandidateStore } from "../candidate/candidateStore.js";
import type { ChangeRecord } from "../change/change.js";
import type { ChangeStore } from "../change/changeStore.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  CandidateValidationRunStore,
  CandidateValidationToolingFailure,
} from "./candidateValidationRunStore.js";
import { readValidationArtifactContent } from "../validationRun/artifactContent.js";

const candidateValidationArtifactPreviewBytes = 1_000;

export type CandidateValidationArtifactRecord = CandidateValidationArtifact;

export type CandidateValidationRunInspection = {
  readonly validationRun: CandidateValidationRunRecord;
  readonly change: ChangeRecord;
  readonly candidate: CandidateRecord;
  readonly prepareRounds: readonly CandidateValidationRound[];
  readonly checkRounds: readonly CandidateValidationRound[];
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
  readonly inspectRun: (validationRunId: string) => CandidateValidationRunInspection | undefined;
  readonly readArtifact: (
    validationRunId: string,
    artifactRef: string,
  ) => CandidateValidationArtifactContentResult;
};

export const openCandidateValidationRunInspection = (input: {
  readonly runStore: CandidateValidationRunStore;
  readonly candidateStore: CandidateStore;
  readonly changeStore: ChangeStore;
  readonly artifactsRoot: string;
}): CandidateValidationRunInspectionUseCases => ({
  inspectRun: (validationRunId) => inspectRun(input, validationRunId),
  readArtifact: (validationRunId, artifactRef) => readArtifact(input, validationRunId, artifactRef),
});

const inspectRun = (
  dependencies: {
    readonly runStore: CandidateValidationRunStore;
    readonly candidateStore: CandidateStore;
    readonly changeStore: ChangeStore;
    readonly artifactsRoot: string;
  },
  validationRunId: string,
): CandidateValidationRunInspection | undefined => {
  const validationRun = dependencies.runStore.getRunById(validationRunId);
  if (validationRun === undefined) return undefined;

  const candidate = dependencies.candidateStore.getCandidateById(validationRun.candidateId);
  if (candidate === undefined) throw new Error("Candidate-owned Validation Run has no Candidate");
  const change = dependencies.changeStore.getChangeById(candidate.changeId);
  if (change === undefined) throw new Error("Candidate-owned Validation Run has no Change");
  const rounds = dependencies.runStore.listRounds(validationRunId);

  return {
    validationRun,
    change,
    candidate,
    prepareRounds: rounds.filter((round) => round.phase === "prepare"),
    checkRounds: rounds.filter((round) => round.phase === "checks"),
    findings: dependencies.runStore.listFindings(validationRunId),
    toolingFailures: dependencies.runStore.listToolingFailures(validationRunId),
    artifacts: dependencies.runStore.listArtifacts(validationRunId).map((artifact) => ({
      ...artifact,
      preview: readPreview(dependencies.artifactsRoot, artifact),
    })),
  };
};

const readArtifact = (
  dependencies: {
    readonly runStore: CandidateValidationRunStore;
    readonly artifactsRoot: string;
  },
  validationRunId: string,
  artifactRef: string,
): CandidateValidationArtifactContentResult => {
  if (dependencies.runStore.getRunById(validationRunId) === undefined) {
    return { ok: false, code: "validation_run_not_found" };
  }
  const artifact = dependencies.runStore
    .listArtifacts(validationRunId)
    .find((candidate) => candidate.ref === artifactRef);
  if (artifact === undefined) return { ok: false, code: "artifact_not_found" };

  const content = readValidationArtifactContent(dependencies.artifactsRoot, artifact.path);
  return content === undefined
    ? { ok: false, code: "artifact_content_unavailable" }
    : { ok: true, artifact, content: content.toString("utf8") };
};

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
