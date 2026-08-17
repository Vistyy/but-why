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
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";
import { runAgentReviewer } from "../validation/runAgentReviewer.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ReviewerExecutionEvidence } from "../validationRun/reviewerArtifacts.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { SpecialistReviewPolicy } from "./specialistReviewConfig.js";

export type RunSpecialistReviewPhaseInput = {
  readonly validationRunId: string;
  readonly changeId: string;
  readonly candidate: {
    readonly candidateId: string;
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
  readonly sessionStorageRoot: string;
  readonly agentPersistence: AgentSessionPersistence;
  readonly getAgentSession: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<number | undefined, RepositoryStorageError>;
  readonly linkAgentInvocation: (input: {
    readonly changeId: string;
    readonly producer: string;
    readonly validationRunId: string;
    readonly phase: string;
    readonly configurationSnapshot?: unknown;
  }) => AgentSessionSqlLink;
  readonly settleAgentInvocationRound: NonNullable<
    CandidateValidationExecutionPort["settleAgentInvocationRound"]
  >;
  readonly allowedUntrackedFiles: readonly string[];
  readonly progress?: SubmitProgress;
  readonly now: string;
  readonly listArtifacts: (
    validationRunId: string,
  ) => Effect.Effect<readonly { readonly ref: string }[], RepositoryStorageError>;
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: string;
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

export type SpecialistReviewerContinuityEvidence = ReviewerExecutionEvidence & {
  readonly producer: string;
};

export type RunSpecialistReviewPhaseResult = {
  readonly findings: 0 | 1;
  readonly persistedToolingFailures?: readonly ValidationToolingFailure[];
  readonly toolingFailures: readonly ValidationToolingFailure[];
  readonly reviewerEvidence: readonly SpecialistReviewerContinuityEvidence[];
};

export const runSpecialistReviewPhase = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<
  RunSpecialistReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    let hasFindings = false;
    const persistedToolingFailures: ValidationToolingFailure[] = [];
    const toolingFailures: ValidationToolingFailure[] = [];
    const reviewerEvidence: SpecialistReviewerContinuityEvidence[] = [];

    for (const [index, policy] of input.policies.entries()) {
      const result = yield* runWithSubmitProgress({
        progress: input.progress,
        phase: {
          kind: "specialist",
          id: policy.id,
          profile: progressProfile(policy.profile),
        },
        run: runSpecialist(input, policy, index + 1),
        outcome: (review) =>
          review.toolingFailure === undefined && !review.hasFindings ? "passed" : "failed",
        details: (review) => ({
          ...(review.toolingFailure !== undefined
            ? { reason: "tooling" as const }
            : review.hasFindings
              ? { reason: "findings" as const }
              : {}),
          ...(review.reviewerEvidence?.continuity === undefined ||
          review.reviewerEvidence.reviewCalls === undefined
            ? {}
            : {
                continuity: review.reviewerEvidence.continuity,
                reviewCalls: review.reviewerEvidence.reviewCalls,
              }),
        }),
      });
      if (result.hasFindings) hasFindings = true;
      if (result.toolingFailure !== undefined) {
        toolingFailures.push(result.toolingFailure);
        if (result.toolingFailurePersisted) persistedToolingFailures.push(result.toolingFailure);
      }
      if (result.reviewerEvidence !== undefined) reviewerEvidence.push(result.reviewerEvidence);
    }

    return {
      findings: hasFindings ? 1 : 0,
      ...(persistedToolingFailures.length === 0 ? {} : { persistedToolingFailures }),
      toolingFailures,
      reviewerEvidence,
    };
  });

const runSpecialist = (
  input: RunSpecialistReviewPhaseInput,
  policy: SpecialistReviewPolicy,
  roundNumber: number,
): Effect.Effect<
  {
    readonly hasFindings: boolean;
    readonly toolingFailure?: ValidationToolingFailure;
    readonly toolingFailurePersisted?: boolean;
    readonly reviewerEvidence?: SpecialistReviewerContinuityEvidence;
  },
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    yield* verifyIntegrity(input);
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
      roundNumber,
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
      profile: policy.profile,
      sessionStorageRoot: input.sessionStorageRoot,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      allowedUntrackedFiles: input.allowedUntrackedFiles,
      expectedHeadSha: input.candidate.headSha,
      now: input.now,
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
      settleAgentInvocationRound: input.settleAgentInvocationRound,
    });
    const specialistEvidence: SpecialistReviewerContinuityEvidence = {
      producer: policy.id,
      ...execution.reviewerEvidence,
    };
    if (execution.toolingFailure !== undefined) {
      return {
        hasFindings: false,
        toolingFailure: execution.toolingFailure,
        toolingFailurePersisted: true,
        reviewerEvidence: specialistEvidence,
      };
    }
    if (!execution.result.ok) {
      return {
        hasFindings: false,
        toolingFailure: execution.result.failure,
        reviewerEvidence: specialistEvidence,
      };
    }
    return {
      hasFindings: execution.result.report.findings.length > 0,
      reviewerEvidence: specialistEvidence,
    };
  });

const agentConfiguration = (
  profile: SpecialistReviewPolicy["profile"],
): AgentSessionConfiguration => ({
  harness: "pi",
  provider: null,
  model: profile.profile.runtimeConfig?.model ?? "",
  thinking: profile.profile.runtimeConfig?.thinking ?? null,
});

const progressProfile = (profile: SpecialistReviewPolicy["profile"]): SubmitProgressProfile => ({
  name: profile.agentProfile,
  model: profile.profile.runtimeConfig?.model ?? "unknown",
  thinking: profile.profile.runtimeConfig?.thinking ?? "default",
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
