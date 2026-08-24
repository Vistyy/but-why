import type { Effect } from "effect";
import type { ResolvedReviewerPiAgentProfile } from "../agent/agentProfiles.js";
import type { AgentInvocationRecord } from "../agent/agentSession/agentSession.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { ImplementationBlockerHistory } from "./implementationBlocker.js";
import type { AcceptanceContextSnapshotV1 } from "./validationRun/acceptanceContextSnapshot.js";
import type { ValidationRunFindingRecord } from "./validationRun/validationRun.js";

export type StallDetectionDecision = "continue" | "stop";

export type StallDetectionRunInput = {
  readonly validationRunId: number;
  readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
  readonly resolutionPrefix: readonly string[];
  readonly findings: readonly ValidationRunFindingRecord[];
};

export type StallDetectionAssessmentInput = {
  readonly changeId: string;
  readonly triggeringValidationRunId: number;
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly qualifyingRuns: readonly StallDetectionRunInput[];
  readonly blockerHistory: ImplementationBlockerHistory;
};

export type StallDetectionAssessment = {
  readonly decision: StallDetectionDecision;
  readonly reason: string;
};

export type StallDetectionRecord = {
  readonly id: number;
  readonly changeId: string;
  readonly validationRunId: number;
  readonly agentSessionId: number;
  readonly decision: StallDetectionDecision;
  readonly reason: string;
  readonly configuration: ResolvedReviewerPiAgentProfile;
  readonly input: StallDetectionAssessmentInput;
  readonly invocations: readonly AgentInvocationRecord[];
  readonly blockerId: number | null;
  readonly createdAt: string;
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
    readonly assessment: StallDetectionAssessment;
    readonly assessmentInput: StallDetectionAssessmentInput;
    readonly configuration: ResolvedReviewerPiAgentProfile;
    readonly agentSessionId: number;
    readonly invocationIds: readonly number[];
    readonly now: string;
  }) => EffectResult<StallDetectionRecord>;
};

type EffectResult<A> = Effect.Effect<A, RepositoryStorageError>;
