import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type {
  AgentSessionConfiguration,
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../../agent/agentSession/agentSession.js";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import {
  decodeReviewerOutputContract,
  type ReviewerOutput,
  validateReviewerArtifactRefs,
} from "../../agent/reviewerOutput.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  DisposableWorkspaceIdentity,
  RestoreDisposableWorkspace,
} from "../../disposableWorkspace/disposableWorkspace.js";
import {
  buildReviewerOutputCorrectionPrompt,
  reviewerFindingHistory,
} from "../../reviewerPrompts/reviewerPromptSupport.js";
import {
  buildSpecialistContinuationPrompt,
  buildSpecialistReviewerPrompt,
  buildSpecialistReviewerSystemPrompt,
} from "../../reviewerPrompts/specialistReviewerPrompt.js";
import {
  runWithSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
} from "../../submission/submissionProgress.js";
import type { CandidateValidationOutcome } from "../candidateValidation/candidateValidationRunStore.js";
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";
import { runAgentReviewer } from "../validation/runAgentReviewer.js";
import {
  type ValidationToolingFailure,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { SpecialistReviewPolicy } from "./specialistReviewConfig.js";

export type RunSpecialistReviewPhaseInput = {
  readonly validationRunId: number;
  readonly changeId: string;
  readonly candidate: {
    readonly candidateId: number;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly policies: readonly SpecialistReviewPolicy[];
  readonly acceptanceContext?: AcceptanceContextSnapshotV1;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly runtime: ReviewerAgentRuntime<ReviewerOutput>;
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd: string;
  readonly resourceRoot?: string;
  readonly workspaceIdentity: DisposableWorkspaceIdentity;
  readonly restoreWorkspace: RestoreDisposableWorkspace;
  readonly sessionStorageRoot: string;
  readonly agentPersistence: AgentSessionPersistence;
  readonly getAgentSession: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<number | undefined, RepositoryStorageError>;
  readonly linkAgentInvocation: (input: {
    readonly changeId: string;
    readonly producer: string;
    readonly validationRunId: number;
    readonly phase: string;
    readonly configurationSnapshot: SpecialistReviewPolicy;
  }) => AgentSessionSqlLink;
  readonly settleAgentInvocationResult: NonNullable<
    CandidateValidationExecutionPort["settleAgentInvocationResult"]
  >;
  readonly recordSpecialistResult: CandidateValidationExecutionPort["recordSpecialistResult"];
  readonly allowedUntrackedFiles: readonly string[];
  readonly progress?: SubmitProgress;
  readonly listArtifacts: (
    validationRunId: number,
  ) => Effect.Effect<readonly { readonly ref: string }[], RepositoryStorageError>;
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: number;
    readonly phase: "specialist_review";
    readonly producer: string;
  }) => Effect.Effect<
    readonly {
      readonly title: string;
      readonly description: string;
      readonly evidence: string;
      readonly files: readonly string[];
      readonly artifactRefs: readonly string[];
    }[],
    RepositoryStorageError
  >;
};

export type RunSpecialistReviewPhaseResult = {
  readonly outcome: CandidateValidationOutcome;
};

export const runSpecialistReviewPhase = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<
  RunSpecialistReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    for (const policy of input.policies) {
      const result = yield* runWithSubmitProgress({
        progress: input.progress,
        phase: {
          kind: "specialist",
          id: policy.id,
          profile: progressProfile(policy.profile),
        },
        run: runSpecialist(input, policy),
        outcome: (review) => (review.outcome === "passed" ? "passed" : "failed"),
        details: (review) =>
          review.outcome === "tooling_failed"
            ? { reason: "tooling" as const }
            : review.outcome === "blocked"
              ? { reason: "findings" as const }
              : undefined,
      });
      if (result.outcome === "tooling_failed") {
        return { outcome: "tooling_failed" };
      }
      if (result.outcome === "blocked") {
        return { outcome: "blocked" };
      }
    }

    return { outcome: "passed" };
  });

const runSpecialist = (
  input: RunSpecialistReviewPhaseInput,
  policy: SpecialistReviewPolicy,
): Effect.Effect<
  RunSpecialistReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const integrity = yield* Effect.either(verifyIntegrity(input));
    if (integrity._tag === "Left") {
      yield* input.recordSpecialistResult({
        validationRunId: input.validationRunId,
        producer: policy.id,
        outcome: "failed",
        findings: [],
        artifactRecords: [],
        toolingFailure: {
          ...validationToolingFailureRecord(integrity.left),
          validationRunId: input.validationRunId,
        },
      });
      return { outcome: "tooling_failed" as const };
    }

    const availableArtifactRefs = (yield* input.listArtifacts(input.validationRunId)).map(
      (artifact) => artifact.ref,
    );
    const earlierFindings = reviewerFindingHistory(
      yield* input.listPreviousCandidateReviewerFindings({
        candidateId: input.candidate.candidateId,
        phase: validationPhase.specialistReview,
        producer: policy.id,
      }),
    );
    const systemPrompt = buildSpecialistReviewerSystemPrompt({
      specialist: policy.id,
      instructions: policy.instructions,
    });
    const prompt = buildSpecialistReviewerPrompt({
      specialist: policy.id,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      candidate: {
        changeBaseSha: input.candidate.changeBaseSha,
        headSha: input.candidate.headSha,
      },
      previousFindings: earlierFindings,
      ...(input.acceptanceContext === undefined
        ? {}
        : { acceptanceContext: input.acceptanceContext }),
    });
    const continuationPrompt = buildSpecialistContinuationPrompt({
      specialist: policy.id,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      candidate: input.candidate,
      previousFindings: earlierFindings,
      ...(input.acceptanceContext === undefined
        ? {}
        : { acceptanceContext: input.acceptanceContext }),
    });
    const agentSessionId = yield* input.getAgentSession(input.changeId, policy.id);
    const execution = yield* runAgentReviewer({
      ...(agentSessionId === undefined ? {} : { agentSessionId }),
      validationRunId: input.validationRunId,
      phase: validationPhase.specialistReview,
      producer: policy.id,
      reviewer: policy.id,
      configuration: agentConfiguration(policy.profile),
      agentPersistence: input.agentPersistence,
      linkInvocation: input.linkAgentInvocation({
        changeId: input.changeId,
        producer: policy.id,
        validationRunId: input.validationRunId,
        phase: validationPhase.specialistReview,
        configurationSnapshot: policy,
      }),
      reviewerRuntime: input.runtime,
      reviewerExecutor: input.reviewerExecutor,
      decodeOutput: (output, reviewCall) =>
        decodeReviewerOutputContract({
          reviewer: policy.id,
          attempts: reviewCall,
          output,
        }).pipe(
          Effect.flatMap((decoded) =>
            validateReviewerArtifactRefs({
              reviewer: policy.id,
              attempts: reviewCall,
              validationRunId: input.validationRunId,
              output: decoded,
              availableArtifactRefs,
            }),
          ),
          Effect.mapError(
            (failure) =>
              new ReviewerExecutionFailed({
                kind: "output_contract",
                operationName: failure.operationName,
                message: failure.message,
                diagnostics: failure.diagnostics,
                correctionPrompt: buildReviewerOutputCorrectionPrompt(failure),
              }),
          ),
        ),
      systemPrompt,
      prompt,
      continuationPrompt,
      commandCwd: input.commandCwd,
      commandExecutor: input.commandExecutor,
      resourceRoot: input.resourceRoot ?? input.commandCwd,
      workspaceIdentity: input.workspaceIdentity,
      restoreWorkspace: input.restoreWorkspace,
      profile: policy.profile,
      sessionStorageRoot: input.sessionStorageRoot,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      expectedHeadSha: input.candidate.headSha,
      makeFindings: (result) =>
        result.ok
          ? result.report.findings.map((finding, findingIndex) => ({
              id: `${input.validationRunId}-${policy.id}-F${findingIndex + 1}`,
              validationRunId: input.validationRunId,
              phase: validationPhase.specialistReview,
              producer: policy.id,
              ...finding,
            }))
          : [],
      settleAgentInvocationResult: input.settleAgentInvocationResult,
    });
    return execution;
  });

const agentConfiguration = (
  profile: SpecialistReviewPolicy["profile"],
): AgentSessionConfiguration => ({
  harness: "pi",
  provider: null,
  model: profile.profile.runtimeConfig.model,
  thinking: profile.profile.runtimeConfig.thinking ?? null,
});

const progressProfile = (profile: SpecialistReviewPolicy["profile"]): SubmitProgressProfile => ({
  name: profile.agentProfile,
  model: profile.profile.runtimeConfig.model,
  thinking: profile.profile.runtimeConfig.thinking ?? "default",
});

const verifyIntegrity = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  verifyCandidateIntegrity({
    commandExecutor: input.commandExecutor,
    commandCwd: input.commandCwd,
    expectedHeadSha: input.candidate.headSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
    operationName: "verify_specialist_candidate",
  });
