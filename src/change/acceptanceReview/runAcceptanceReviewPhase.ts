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
  buildAcceptanceReviewerPrompt,
  buildReviewerOutputCorrectionPrompt,
  reviewerFindingHistory,
} from "../../agent/reviewerPrompts.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  decodeReviewerOutputContract,
  type ReviewerOutput,
  validateReviewerArtifactRefs,
} from "../../contracts/reviewerOutput.js";
import type { RecordCandidateAcceptanceRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import {
  executeReviewerSession,
  type ReviewerExecutionEvidence,
} from "../reviewerSession/executeReviewerSession.js";
import {
  continuationPrompt,
  type ReviewerSessionStore,
} from "../reviewerSession/reviewerSession.js";
import {
  runWithSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
} from "../validation/submitProgress.js";
import {
  ReviewerOutputContractFailed,
  ReviewerProcessToolingFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReviewConfig.js";

const translateRuntimeResult = <Output>(
  result: ReviewerAgentResult<Output>,
  reviewer: string,
):
  | Extract<ReviewerAgentResult<Output>, { readonly ok: true }>
  | (Omit<Extract<ReviewerAgentResult<Output>, { readonly ok: false }>, "failure"> & {
      readonly failure: ValidationToolingFailure;
    }) => {
  if (result.ok) return result;
  const failure =
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

export type RunAcceptanceReviewPhaseInput = {
  readonly validationRunId: string;
  readonly changeId: string;
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly blockerHistory?: ImplementationBlockerHistory;
  readonly policy: AcceptanceReviewPolicy;
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
    readonly phase: "acceptance_review";
    readonly producer: "acceptance";
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
  readonly recordAcceptanceRound: (
    input: RecordCandidateAcceptanceRoundInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};
export type RunAcceptanceReviewPhaseResult = {
  readonly findings: 0 | 1;
  readonly reviewerEvidence?: ReviewerExecutionEvidence;
  readonly toolingFailure?: ValidationToolingFailure;
};

export const runAcceptanceReviewPhase = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<
  RunAcceptanceReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  runWithSubmitProgress({
    progress: input.progress,
    phase: { kind: "acceptance", profile: progressProfile(input.policy.profile) },
    run: runAcceptanceReviewPhaseImpl(input),
    outcome: (result) =>
      result.toolingFailure === undefined && result.findings === 0 ? "passed" : "failed",
    details: (result) => ({
      ...(result.toolingFailure !== undefined
        ? { reason: "tooling" as const }
        : result.findings === 1
          ? { reason: "findings" as const }
          : {}),
      ...(result.reviewerEvidence === undefined
        ? {}
        : {
            continuity: result.reviewerEvidence.continuity,
            reviewCalls: result.reviewerEvidence.reviewCalls,
          }),
    }),
  });

const runAcceptanceReviewPhaseImpl = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<
  RunAcceptanceReviewPhaseResult,
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
        phase: validationPhase.acceptanceReview,
        producer: "acceptance",
      }),
    );
    const prompt = buildAcceptanceReviewerPrompt({
      instructions: input.policy.instructions,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      previousFindings: earlierFindings,
      candidate: input.candidate,
      acceptanceContext: input.acceptanceContext,
      implementationDecisions: input.implementationDecisions,
      ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
    });
    const identity = {
      changeId: input.changeId,
      producer: "acceptance" as const,
      agentProfile: input.policy.profile,
      instructions: input.policy.instructions,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      resources: {
        ...(input.policy.profile.profile.runtimeConfig?.extensions === undefined
          ? {}
          : { extensions: input.policy.profile.profile.runtimeConfig.extensions }),
        ...(input.policy.profile.profile.runtimeConfig?.skills === undefined
          ? {}
          : { skills: input.policy.profile.profile.runtimeConfig.skills }),
        ...(input.policy.profile.profile.runtimeConfig?.tools === undefined
          ? {}
          : { tools: input.policy.profile.profile.runtimeConfig.tools }),
      },
    };
    const execution = yield* executeReviewerSession({
      identity,
      runtime: input.runtime,
      reviewerExecutor: input.reviewerExecutor,
      decodeOutput: (output, reviewCall) =>
        decodeReviewerOutputContract({
          reviewer: "acceptance",
          attempts: reviewCall,
          output,
        }).pipe(
          Effect.flatMap((decoded) =>
            validateReviewerArtifactRefs({
              reviewer: "acceptance",
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
      continuationPrompt: continuationPrompt({
        candidate: input.candidate,
        acceptanceContext: input.acceptanceContext,
        implementationDecisions: input.implementationDecisions,
        ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
        availableArtifactRefs,
        previousFindings: earlierFindings,
      }),
      commandCwd: input.commandCwd,
      ...(input.resourceRoot === undefined ? {} : { resourceRoot: input.resourceRoot }),
      ...(input.sessionStorageRoot === undefined
        ? {}
        : { sessionStorageRoot: input.sessionStorageRoot }),
      ...(input.sessionStore === undefined ? {} : { sessionStore: input.sessionStore }),
      completeReview: ({ initialResult }) => verifyIntegrity(input).pipe(Effect.as(initialResult)),
    });
    const result = translateRuntimeResult(execution.result, "acceptance");
    const reviewerEvidence = execution.evidence;
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.acceptanceReview,
      producer: "acceptance",
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      executionEvidence: reviewerEvidence,
    });
    const findings = result.ok
      ? result.report.findings.map((finding, index) => ({
          id: `${input.validationRunId}-acceptance-F${index + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.acceptanceReview,
          producer: "acceptance" as const,
          ...finding,
        }))
      : [];
    yield* input.recordAcceptanceRound({
      validationRunId: input.validationRunId,
      roundNumber: 1,
      roundStatus: result.ok && findings.length === 0 ? "passed" : "failed",
      artifactRecords: artifacts,
      findings,
      now: input.now,
    });
    if (!result.ok) {
      return {
        findings: 0,
        reviewerEvidence,
        toolingFailure: result.failure,
      };
    }
    return {
      findings: findings.length === 0 ? 0 : 1,
      reviewerEvidence,
    };
  });

const progressProfile = (
  profile: RunAcceptanceReviewPhaseInput["policy"]["profile"],
): SubmitProgressProfile => ({
  name: profile.agentProfile,
  model: profile.profile.runtimeConfig?.model ?? "unknown",
  thinking: profile.profile.runtimeConfig?.thinking ?? "default",
});

const verifyIntegrity = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  verifyCandidateIntegrity({
    commandExecutor: input.commandExecutor,
    commandCwd: input.commandCwd,
    expectedHeadSha: input.candidate.headSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
    operationName: "verify_acceptance_candidate",
  });
