import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type {
  AgentSessionConfiguration,
  AgentSessionPersistence,
  AgentSessionSqlLink,
} from "../../agent/agentSession/agentSession.js";
import {
  type AgentExecutionEvidence,
  executeAgentSession,
} from "../../agent/agentSession/executeAgentSession.js";
import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
import { ReviewerOutputContractFailed } from "../../agent/reviewerOutput.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
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
  ReviewerProcessToolingFailed,
  validationToolingFailureRecord,
} from "./validationToolingFailures.js";
import { verifyCandidateIntegrity } from "./verifyCandidateIntegrity.js";

export type TranslatedReviewerResult<Output> =
  | Extract<ReviewerAgentResult<Output>, { readonly ok: true }>
  | (Omit<Extract<ReviewerAgentResult<Output>, { readonly ok: false }>, "failure"> & {
      readonly failure: ValidationToolingFailure;
    });

export type RunAgentReviewerInput = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
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
  readonly allowedUntrackedFiles: readonly string[];
  readonly expectedHeadSha: string;
  readonly now: string;
  readonly makeFindings: (
    result: TranslatedReviewerResult<ReviewerOutput>,
  ) => readonly Omit<ValidationRunFindingRecord, "createdAt" | "updatedAt">[];
  readonly settleAgentInvocationRound: NonNullable<
    CandidateValidationExecutionPort["settleAgentInvocationRound"]
  >;
};

export type RunAgentReviewerResult = {
  readonly result: TranslatedReviewerResult<ReviewerOutput>;
  readonly evidence: AgentExecutionEvidence;
  readonly reviewerEvidence: ReturnType<typeof reviewerEvidenceFromAgentSession>;
  readonly toolingFailure?: ValidationToolingFailure;
};

export const runAgentReviewer = (
  input: RunAgentReviewerInput,
): Effect.Effect<
  RunAgentReviewerResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> => {
  let persistedToolingFailure: ValidationToolingFailure | undefined;
  return Effect.gen(function* () {
    const execution = yield* executeAgentSession<ReviewerOutput, never, FileSystem.FileSystem>({
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
      settleDomain: ({ result: runtimeResult, evidence }) =>
        Effect.gen(function* () {
          const result = translateRuntimeResult(runtimeResult, input.reviewer);
          const reviewerEvidence = reviewerEvidenceFromAgentSession(evidence);
          const integrity = yield* Effect.either(
            verifyCandidateIntegrity({
              commandExecutor: input.commandExecutor,
              commandCwd: input.commandCwd,
              expectedHeadSha: input.expectedHeadSha,
              allowedUntrackedFiles: input.allowedUntrackedFiles,
              operationName: `verify_${input.phase}_candidate`,
            }),
          );
          if (integrity._tag === "Left") {
            persistedToolingFailure = integrity.left;
            return input.settleAgentInvocationRound({
              validationRunId: input.validationRunId,
              phase: input.phase,
              producer: input.producer,
              roundNumber: input.roundNumber,
              roundStatus: "failed",
              findings: [],
              artifactRecords: [],
              toolingFailure: {
                ...validationToolingFailureRecord(integrity.left),
                validationRunId: input.validationRunId,
              },
              now: input.now,
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
            persistedToolingFailure = artifacts.failure;
            return input.settleAgentInvocationRound({
              validationRunId: input.validationRunId,
              phase: input.phase,
              producer: input.producer,
              roundNumber: input.roundNumber,
              roundStatus: "failed",
              findings: [],
              artifactRecords: [],
              toolingFailure: {
                ...validationToolingFailureRecord(artifacts.failure),
                validationRunId: input.validationRunId,
              },
              now: input.now,
            });
          }

          return input.settleAgentInvocationRound({
            validationRunId: input.validationRunId,
            phase: input.phase,
            producer: input.producer,
            roundNumber: input.roundNumber,
            roundStatus: result.ok && findings.length === 0 ? "passed" : "failed",
            findings,
            artifactRecords: artifacts.artifactRecords,
            now: input.now,
          });
        }),
    });
    const result = translateRuntimeResult(execution.result, input.reviewer);
    return {
      result,
      evidence: execution.evidence,
      reviewerEvidence: reviewerEvidenceFromAgentSession(execution.evidence),
      ...(persistedToolingFailure === undefined ? {} : { toolingFailure: persistedToolingFailure }),
    };
  });
};

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
