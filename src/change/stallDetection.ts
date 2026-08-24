import type { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";
import type { ValidationRunFindingRecord } from "./validationRun/validationRun.js";

export type StallDetectionDecision = "continue" | "stop";

export type StallDetectionFinding = Omit<ValidationRunFindingRecord, "validationRunId">;

export type StallDetectionRunInput = {
  readonly findings: readonly StallDetectionFinding[];
};

export type StallDetectionAssessmentInput = {
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly qualifyingRuns: readonly StallDetectionRunInput[];
};

export type StallDetectionAssessment = {
  readonly decision: StallDetectionDecision;
  readonly reason: string;
};

export type StallDetectionRecord = {
  readonly id: number;
  readonly validationRunId: number;
  readonly agentSessionId: number;
  readonly decision: StallDetectionDecision;
  readonly reason: string;
  readonly blockerId: number | null;
};

export type StallDetectionDiagnostic = {
  readonly code: "stall_detection_unavailable";
  readonly message: string;
};

export type StallDetectionPersistence = {
  readonly getAssessmentInput: (
    changeId: string,
    validationRunId: number,
  ) => EffectResult<StallDetectionAssessmentInput | undefined>;
  readonly getByValidationRun: (
    validationRunId: number,
  ) => EffectResult<StallDetectionRecord | undefined>;
  readonly listForChange: (changeId: string) => EffectResult<readonly StallDetectionRecord[]>;
  readonly record: (input: {
    readonly validationRunId: number;
    readonly agentSessionId: number;
    readonly assessment: StallDetectionAssessment;
  }) => EffectResult<StallDetectionRecord>;
};

type EffectResult<A> = Effect.Effect<A, RepositoryStorageError>;
