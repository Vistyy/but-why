import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type {
  AgentSessionConfiguration,
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../../agent/agentSession/agentSession.js";
import { executeAgentSession } from "../../agent/agentSession/executeAgentSession.js";
import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import { ReviewerOutputContractFailed } from "../../agent/reviewerOutput.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { restoreDisposableWorkspace } from "../../disposableWorkspace/disposableWorkspace.js";
import type { CandidateValidationOutcome } from "../candidateValidation/candidateValidationRunStore.js";
import {
  reviewerEvidenceFromAgentSession,
  writeReviewerArtifacts,
} from "../validationRun/reviewerArtifacts.js";
import type {
  ValidationPhase,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";
import type { CandidateValidationExecutionPort } from "./changeValidationPorts.js";
import type { ValidationToolingFailure } from "./validationToolingFailures.js";
import {
  InfrastructureToolingFailed,
  ReviewerProcessToolingFailed,
  validationToolingFailureRecord,
} from "./validationToolingFailures.js";

export type TranslatedReviewerResult<Output> =
  | Extract<ReviewerAgentResult<Output>, { readonly ok: true }>
  | (Omit<Extract<ReviewerAgentResult<Output>, { readonly ok: false }>, "failure"> & {
      readonly failure: ValidationToolingFailure;
    });

export type RunAgentReviewerInput = {
  readonly validationRunId: number;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly reviewer: string;
  readonly agentSessionId?: number;
  readonly configuration: AgentSessionConfiguration;
  readonly agentPersistence: AgentSessionPersistence;
  readonly linkInvocation: AgentSessionSqlLink;
  readonly reviewerRuntime: ReviewerAgentRuntime<ReviewerOutput>;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly decodeOutput: (
    output: unknown,
    invocation: number,
  ) => ReturnType<Parameters<ReviewerAgentRuntime<ReviewerOutput>["review"]>[0]["decodeOutput"]>;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly continuationPrompt: string;
  readonly commandCwd: string;
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly resourceRoot: string;
  readonly profile: ResolvedPiAgentProfile;
  readonly sessionStorageRoot: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly expectedHeadSha: string;
  readonly makeFindings: (
    result: TranslatedReviewerResult<ReviewerOutput>,
  ) => readonly ValidationRunFindingRecord[];
  readonly settleAgentInvocationResult: NonNullable<
    CandidateValidationExecutionPort["settleAgentInvocationResult"]
  >;
};

export type RunAgentReviewerResult = {
  readonly outcome: CandidateValidationOutcome;
};

export const runAgentReviewer = (
  input: RunAgentReviewerInput,
): Effect.Effect<
  RunAgentReviewerResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> => {
  let phaseOutcome: CandidateValidationOutcome | undefined;
  let integrityFailure: ValidationToolingFailure | undefined;
  return Effect.gen(function* () {
    yield* executeAgentSession<ReviewerOutput, never, FileSystem.FileSystem>({
      ...(input.agentSessionId === undefined ? {} : { agentSessionId: input.agentSessionId }),
      configuration: input.configuration,
      agentPersistence: input.agentPersistence,
      linkInvocation: input.linkInvocation,
      reviewerRuntime: input.reviewerRuntime,
      reviewerExecutor: input.reviewerExecutor,
      decodeOutput: input.decodeOutput,
      systemPrompt: input.systemPrompt,
      prompt: input.prompt,
      continuationPrompt: input.continuationPrompt,
      commandCwd: input.commandCwd,
      resourceRoot: input.resourceRoot,
      profile: input.profile,
      reviewer: input.reviewer,
      sessionStorageRoot: input.sessionStorageRoot,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      afterInvocation: ({ result }) =>
        Effect.gen(function* () {
          const restored = yield* Effect.either(
            Effect.uninterruptible(
              restoreDisposableWorkspace({
                commandExecutor: input.commandExecutor,
                commandCwd: input.commandCwd,
                expectedCommitSha: input.expectedHeadSha,
              }),
            ),
          );
          if (restored._tag === "Right") return result;
          const failure = new InfrastructureToolingFailed({
            operationName: `verify_${input.phase}_candidate`,
            message: restored.left.message,
          });
          integrityFailure = failure;
          return integrityFailureResult(result, failure);
        }),
      settleDomain: ({ result: runtimeResult, evidence }) =>
        Effect.gen(function* () {
          const result = translateRuntimeResult(runtimeResult, input.reviewer);
          const reviewerEvidence = reviewerEvidenceFromAgentSession(evidence);
          if (
            !result.ok &&
            result.failure._tag === "ReviewerProcessToolingFailed" &&
            (result.failure.operationName === "verify_candidate_head" ||
              result.failure.operationName === `verify_${input.phase}_candidate`)
          ) {
            phaseOutcome = "tooling_failed";
            const failure = integrityFailure ?? result.failure;
            return input.settleAgentInvocationResult({
              validationRunId: input.validationRunId,
              phase: input.phase,
              producer: input.producer,
              outcome: "failed",
              findings: [],
              artifactRecords: [],
              toolingFailure: {
                ...validationToolingFailureRecord(failure),
                validationRunId: input.validationRunId,
              },
            });
          }

          const findings = input.makeFindings(result);
          const artifacts = yield* writeReviewerArtifacts({
            validationRunId: input.validationRunId,
            phase: input.phase,
            producer: input.producer,
            result,
            artifactsRoot: input.artifactsRoot,
            ...(input.artifactMaxBytes === undefined
              ? {}
              : { artifactMaxBytes: input.artifactMaxBytes }),
            executionEvidence: reviewerEvidence,
          }).pipe(
            Effect.map((artifactRecords) => ({ ok: true as const, artifactRecords })),
            Effect.catchAll((failure) => Effect.succeed({ ok: false as const, failure })),
          );
          if (!artifacts.ok) {
            phaseOutcome = "tooling_failed";
            return input.settleAgentInvocationResult({
              validationRunId: input.validationRunId,
              phase: input.phase,
              producer: input.producer,
              outcome: "failed",
              findings: [],
              artifactRecords: [],
              toolingFailure: {
                ...validationToolingFailureRecord(artifacts.failure),
                validationRunId: input.validationRunId,
              },
            });
          }

          const toolingFailure = result.ok ? undefined : result.failure;
          phaseOutcome =
            toolingFailure !== undefined
              ? "tooling_failed"
              : findings.length > 0
                ? "blocked"
                : "passed";
          return input.settleAgentInvocationResult({
            validationRunId: input.validationRunId,
            phase: input.phase,
            producer: input.producer,
            outcome: result.ok && findings.length === 0 ? "passed" : "failed",
            findings,
            artifactRecords: artifacts.artifactRecords,
            ...(toolingFailure === undefined
              ? {}
              : {
                  toolingFailure: {
                    ...validationToolingFailureRecord(toolingFailure),
                    validationRunId: input.validationRunId,
                  },
                }),
          });
        }),
    });
    if (phaseOutcome === undefined) {
      return yield* Effect.die("Agent reviewer completed without phase settlement");
    }
    return { outcome: phaseOutcome };
  });
};

const integrityFailureResult = <Output>(
  result: ReviewerAgentResult<Output>,
  failure: ValidationToolingFailure,
): ReviewerAgentResult<Output> => ({
  ok: false,
  failure: {
    kind: "process_execution",
    operationName: failure.operationName,
    message: failureMessage(failure),
    sessionUsability: "unknown",
    ...(result.sessionReference === undefined ? {} : { sessionReference: result.sessionReference }),
    ...(result.sessionFilePath === undefined ? {} : { sessionFilePath: result.sessionFilePath }),
  },
  sessionUsability: "unknown",
  attempts: result.attempts,
  stdout: result.stdout,
  ...(result.invocationUsage === undefined ? {} : { invocationUsage: result.invocationUsage }),
  ...(result.sessionReference === undefined ? {} : { sessionReference: result.sessionReference }),
  ...(result.sessionFilePath === undefined ? {} : { sessionFilePath: result.sessionFilePath }),
});

const failureMessage = (failure: ValidationToolingFailure): string =>
  failure._tag === "SnapshotWorkspaceSetupFailed" ? failure.errorMessage : failure.message;

const translateRuntimeResult = <Output>(
  result: ReviewerAgentResult<Output>,
  reviewer: string,
): TranslatedReviewerResult<Output> => {
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
