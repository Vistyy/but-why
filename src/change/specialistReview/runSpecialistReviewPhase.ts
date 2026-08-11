import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import {
  type ReviewerAgentResult,
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import {
  decodeReviewerOutputContract,
  type ReviewerOutput,
  ReviewerOutputContractFailed,
  validateReviewerArtifactRefs,
} from "../../agent/reviewerOutput.js";
import {
  executeReviewerSession,
  type ReviewerExecutionEvidence,
} from "../../agent/reviewerSession/executeReviewerSession.js";
import type { ReviewerSessionStore } from "../../agent/reviewerSession/reviewerSession.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  buildReviewerOutputCorrectionPrompt,
  buildReviewerRevisionPrompt,
  reviewerFindingHistory,
} from "../../reviewerPrompts/reviewerPromptSupport.js";
import {
  buildSpecialistContinuationPrompt,
  buildSpecialistReviewerPrompt,
} from "../../reviewerPrompts/specialistReviewerPrompt.js";
import type { RecordCandidateSpecialistRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import {
  runWithSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
} from "../validation/submitProgress.js";
import {
  ReviewerProcessToolingFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { SpecialistReviewPolicy } from "./specialistReviewConfig.js";

const translateRuntimeResult = <Output>(
  result: ReviewerAgentResult<Output>,
  reviewer: string,
):
  | Extract<ReviewerAgentResult<Output>, { readonly ok: true }>
  | (Omit<Extract<ReviewerAgentResult<Output>, { readonly ok: false }>, "failure"> & {
      readonly failure: ValidationToolingFailure;
    }) => {
  if (result.ok) return result;
  const failure: ValidationToolingFailure =
    result.failure.kind === "process_execution"
      ? new ReviewerProcessToolingFailed({
          operationName: result.failure.operationName,
          message: result.failure.message,
        })
      : new ReviewerOutputContractFailed({
          operationName: result.failure.operationName,
          reviewer,
          attempts: result.attempts,
          diagnostics: result.failure.diagnostics ?? [],
          message: result.failure.message,
        });
  return {
    ok: false,
    failure,
    sessionUsability: result.sessionUsability,
    attempts: result.attempts,
    stdout: result.stdout,
    ...(result.invocationUsage === undefined ? {} : { invocationUsage: result.invocationUsage }),
    ...(result.sessionReference === undefined ? {} : { sessionReference: result.sessionReference }),
    ...(result.sessionFilePath === undefined ? {} : { sessionFilePath: result.sessionFilePath }),
  };
};

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
  readonly sessionStorageRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
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
  readonly recordSpecialistRound: (
    input: RecordCandidateSpecialistRoundInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type SpecialistReviewerContinuityEvidence = ReviewerExecutionEvidence & {
  readonly producer: string;
};

export type RunSpecialistReviewPhaseResult = {
  readonly findings: 0 | 1;
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
          ...(review.reviewerEvidence === undefined
            ? {}
            : {
                continuity: review.reviewerEvidence.continuity,
                reviewCalls: review.reviewerEvidence.reviewCalls,
              }),
        }),
      });
      if (result.hasFindings) hasFindings = true;
      if (result.toolingFailure !== undefined) toolingFailures.push(result.toolingFailure);
      if (result.reviewerEvidence !== undefined) reviewerEvidence.push(result.reviewerEvidence);
    }

    return {
      findings: hasFindings ? 1 : 0,
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
    const prompt = buildSpecialistReviewerPrompt({
      specialist: policy.id,
      instructions: policy.instructions,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      candidate: {
        changeBaseSha: input.candidate.changeBaseSha,
        headSha: input.candidate.headSha,
      },
      ...(input.acceptanceContext === undefined
        ? {}
        : { acceptanceContext: input.acceptanceContext }),
    });
    const earlierFindings = reviewerFindingHistory(
      yield* input.listPreviousCandidateReviewerFindings({
        candidateId: input.candidate.candidateId,
        phase: validationPhase.specialistReview,
        producer: policy.id,
      }),
    );
    const identity = {
      ownerId: input.changeId,
      fingerprintOwnerKey: "changeId",
      producer: policy.id,
      agentProfile: policy.profile,
      instructions: policy.instructions,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      resources: {
        ...(policy.profile.profile.runtimeConfig?.extensions === undefined
          ? {}
          : { extensions: policy.profile.profile.runtimeConfig.extensions }),
        ...(policy.profile.profile.runtimeConfig?.skills === undefined
          ? {}
          : { skills: policy.profile.profile.runtimeConfig.skills }),
        ...(policy.profile.profile.runtimeConfig?.tools === undefined
          ? {}
          : { tools: policy.profile.profile.runtimeConfig.tools }),
      },
    } as const;
    const execution = yield* executeReviewerSession({
      identity,
      runtime: input.runtime,
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
      prompt,
      continuationPrompt: buildSpecialistContinuationPrompt({
        specialist: policy.id,
        instructions: policy.instructions,
        validationRunId: input.validationRunId,
        availableArtifactRefs,
        candidate: input.candidate,
        previousFindings: earlierFindings,
        ...(input.acceptanceContext === undefined
          ? {}
          : { acceptanceContext: input.acceptanceContext }),
      }),
      commandCwd: input.commandCwd,
      ...(input.resourceRoot === undefined ? {} : { resourceRoot: input.resourceRoot }),
      ...(input.sessionStorageRoot === undefined
        ? {}
        : { sessionStorageRoot: input.sessionStorageRoot }),
      ...(input.sessionStore === undefined ? {} : { sessionStore: input.sessionStore }),
      completeReview: ({ initialResult, review }) =>
        Effect.gen(function* () {
          yield* verifyIntegrity(input);
          if (!initialResult.ok || earlierFindings.length === 0) return initialResult;
          const result = yield* review(
            buildReviewerRevisionPrompt({
              reviewPrompt: prompt,
              provisionalReport: initialResult.report,
              earlierFindings,
            }),
            initialResult.sessionReference,
          );
          yield* verifyIntegrity(input);
          return result;
        }),
    });
    const result = translateRuntimeResult(execution.result, policy.id);
    const reviewerEvidence = {
      producer: policy.id,
      ...execution.evidence,
    };
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.specialistReview,
      producer: policy.id,
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      executionEvidence: reviewerEvidence,
    });
    const findings = result.ok
      ? result.report.findings.map((finding, findingIndex) => ({
          id: `${input.validationRunId}-${policy.id}-F${findingIndex + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.specialistReview,
          producer: policy.id,
          ...finding,
        }))
      : [];
    const passed = result.ok && findings.length === 0;

    yield* recordSpecialistRound(input, {
      validationRunId: input.validationRunId,
      producer: policy.id,
      roundNumber,
      roundStatus: passed ? "passed" : "failed",
      artifactRecords: artifacts,
      findings,
      now: input.now,
    });

    return {
      hasFindings: findings.length > 0,
      ...(result.ok ? {} : { toolingFailure: result.failure }),
      reviewerEvidence,
    };
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

const recordSpecialistRound = (
  input: RunSpecialistReviewPhaseInput,
  round: RecordCandidateSpecialistRoundInput,
): Effect.Effect<void, RepositoryStorageError> => input.recordSpecialistRound(round);
