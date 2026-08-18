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
  buildAcceptanceContinuationPrompt,
  buildAcceptanceReviewerPrompt,
  buildAcceptanceReviewerSystemPrompt,
} from "../../reviewerPrompts/acceptanceReviewerPrompt.js";
import {
  buildReviewerOutputCorrectionPrompt,
  reviewerFindingHistory,
} from "../../reviewerPrompts/reviewerPromptSupport.js";
import {
  runWithSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
} from "../../submission/submissionProgress.js";
import type { CandidateValidationOutcome } from "../candidateValidation/candidateValidationRunStore.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import type { CandidateValidationExecutionPort } from "../validation/changeValidationPorts.js";
import { runAgentReviewer } from "../validation/runAgentReviewer.js";
import {
  type ValidationToolingFailure,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReviewConfig.js";

export type RunAcceptanceReviewPhaseInput = {
  readonly validationRunId: number;
  readonly changeId: string;
  readonly candidate: {
    readonly candidateId: number;
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
    readonly configurationSnapshot?: unknown;
  }) => AgentSessionSqlLink;
  readonly settleAgentInvocationResult: NonNullable<
    CandidateValidationExecutionPort["settleAgentInvocationResult"]
  >;
  readonly recordAcceptanceResult: CandidateValidationExecutionPort["recordAcceptanceResult"];
  readonly allowedUntrackedFiles: readonly string[];
  readonly progress?: SubmitProgress;
  readonly listArtifacts: (
    validationRunId: number,
  ) => Effect.Effect<readonly { readonly ref: string }[], RepositoryStorageError>;
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: number;
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
};

export type RunAcceptanceReviewPhaseResult = {
  readonly outcome: CandidateValidationOutcome;
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
    run: Effect.gen(function* () {
      const integrity = yield* Effect.either(verifyIntegrity(input));
      if (integrity._tag === "Left") {
        yield* input.recordAcceptanceResult({
          validationRunId: input.validationRunId,
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
          phase: validationPhase.acceptanceReview,
          producer: "acceptance",
        }),
      );
      const systemPrompt = buildAcceptanceReviewerSystemPrompt(input.policy.instructions);
      const prompt = buildAcceptanceReviewerPrompt({
        validationRunId: input.validationRunId,
        availableArtifactRefs,
        previousFindings: earlierFindings,
        candidate: input.candidate,
        acceptanceContext: input.acceptanceContext,
        implementationDecisions: input.implementationDecisions,
        ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
      });
      const continuationPrompt = buildAcceptanceContinuationPrompt({
        candidate: input.candidate,
        acceptanceContext: input.acceptanceContext,
        implementationDecisions: input.implementationDecisions,
        ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
        availableArtifactRefs,
        previousFindings: earlierFindings,
      });
      const agentSessionId = yield* input.getAgentSession(input.changeId, "acceptance");
      const execution = yield* runAgentReviewer({
        ...(agentSessionId === undefined ? {} : { agentSessionId }),
        validationRunId: input.validationRunId,
        phase: validationPhase.acceptanceReview,
        producer: "acceptance",
        reviewer: "acceptance",
        configuration: agentConfiguration(input.policy.profile),
        agentPersistence: input.agentPersistence,
        linkInvocation: input.linkAgentInvocation({
          changeId: input.changeId,
          producer: "acceptance",
          validationRunId: input.validationRunId,
          phase: validationPhase.acceptanceReview,
          configurationSnapshot: input.policy,
        }),
        reviewerRuntime: input.runtime,
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
        systemPrompt,
        prompt,
        continuationPrompt,
        commandCwd: input.commandCwd,
        commandExecutor: input.commandExecutor,
        resourceRoot: input.resourceRoot ?? input.commandCwd,
        profile: input.policy.profile,
        sessionStorageRoot: input.sessionStorageRoot,
        ...(input.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: input.agentEnvironment }),
        artifactsRoot: input.artifactsRoot,
        ...(input.artifactMaxBytes === undefined
          ? {}
          : { artifactMaxBytes: input.artifactMaxBytes }),
        allowedUntrackedFiles: input.allowedUntrackedFiles,
        expectedHeadSha: input.candidate.headSha,
        makeFindings: (result) =>
          result.ok
            ? result.report.findings.map((finding, index) => ({
                id: `${input.validationRunId}-acceptance-F${index + 1}`,
                validationRunId: input.validationRunId,
                phase: validationPhase.acceptanceReview,
                producer: "acceptance" as const,
                ...finding,
              }))
            : [],
        settleAgentInvocationResult: input.settleAgentInvocationResult,
      });
      return execution;
    }),
    outcome: (result) => (result.outcome === "passed" ? "passed" : "failed"),
    details: (result) =>
      result.outcome === "tooling_failed"
        ? { reason: "tooling" as const }
        : result.outcome === "blocked"
          ? { reason: "findings" as const }
          : undefined,
  });

const agentConfiguration = (
  profile: RunAcceptanceReviewPhaseInput["policy"]["profile"],
): AgentSessionConfiguration => ({
  harness: "pi",
  provider: null,
  model: profile.profile.runtimeConfig?.model ?? "",
  thinking: profile.profile.runtimeConfig?.thinking ?? null,
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
