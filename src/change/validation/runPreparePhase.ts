import type * as FileSystem from "@effect/platform/FileSystem";
import { Clock, Effect } from "effect";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { runRepositoryPreparationEffect } from "../../repositoryPreparation/runRepositoryPreparation.js";
import { runWithSubmitProgress, type SubmitProgress } from "../../submission/submissionProgress.js";
import type {
  CandidateValidationOutcome,
  RecordCandidateValidationPrepareResultInput,
} from "../candidateValidation/candidateValidationRunStore.js";
import type { ChangePrepareDefinition } from "../changePolicy.js";
import { validationPhase } from "../validationRun/validationRun.js";
import { ensureCandidateIntegrity } from "./ensureCandidateIntegrity.js";
import {
  GitToolingFailed,
  InfrastructureToolingFailed,
  PrepareCommandExecutionToolingFailed,
  type ValidationToolingFailure,
  validationToolingFailureRecord,
} from "./validationToolingFailures.js";
import { type ValidationCommandArtifacts, writeCommandEvidence } from "./writeCommandEvidence.js";

export type RunPreparePhaseInput = {
  readonly validationRunId: number;
  readonly prepare: ChangePrepareDefinition;
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd?: string;
  readonly expectedHeadSha?: string;
  readonly allowedUntrackedFiles?: readonly string[];
  readonly progress?: SubmitProgress;
  readonly recordPrepareResult: (
    input: RecordCandidateValidationPrepareResultInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type RunPreparePhaseResult = {
  readonly outcome: CandidateValidationOutcome;
};

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type PrepareCommandResult = {
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
};

const prepareProducer = "prepare";
export const runPreparePhase = (
  input: RunPreparePhaseInput,
): Effect.Effect<
  RunPreparePhaseResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  runWithSubmitProgress({
    progress: input.progress,
    phase: { kind: "prepare" },
    run: Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const execution = yield* Effect.either(
        Effect.gen(function* () {
          const { commandResult, timedOut } = yield* runPrepareCommand(
            input.commandExecutor,
            input.prepare,
            input.commandCwd,
            input.expectedHeadSha,
            input.allowedUntrackedFiles,
          );
          const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
          const artifacts = yield* writePrepareArtifacts({
            validationRunId: input.validationRunId,
            prepare: input.prepare,
            commandResult,
            timedOut,
            durationMs,
            artifactsRoot: input.artifactsRoot,
            ...(input.artifactMaxBytes === undefined
              ? {}
              : { artifactMaxBytes: input.artifactMaxBytes }),
          });
          return { commandResult, timedOut, ...artifacts };
        }),
      );
      if (execution._tag === "Left") {
        yield* recordPrepareResult(input, {
          validationRunId: input.validationRunId,
          outcome: "failed",
          artifactRecords: [],
          toolingFailure: {
            ...validationToolingFailureRecord(execution.left),
            validationRunId: input.validationRunId,
          },
        });
        return { outcome: "tooling_failed" as const };
      }

      const { commandResult, timedOut, artifactRefs, artifactRecords } = execution.right;
      const failed = commandResult.exitCode !== 0;
      yield* recordPrepareResult(input, {
        validationRunId: input.validationRunId,
        outcome: failed ? "failed" : "passed",
        artifactRecords,
        ...(failed
          ? {
              finding: prepareFinding(
                input.validationRunId,
                input.prepare,
                commandResult,
                timedOut,
                artifactRefs,
              ),
            }
          : {}),
      });

      return { outcome: failed ? ("blocked" as const) : ("passed" as const) };
    }),
    outcome: (result) => (result.outcome === "passed" ? "passed" : "failed"),
    details: (result) =>
      result.outcome === "tooling_failed"
        ? { reason: "tooling" as const }
        : result.outcome === "blocked"
          ? { reason: "findings" as const }
          : undefined,
  });

const runPrepareCommand = (
  commandExecutor: WorkspaceCommandExecutor,
  prepare: ChangePrepareDefinition,
  commandCwd: string | undefined,
  expectedHeadSha: string | undefined,
  allowedUntrackedFiles: readonly string[] | undefined,
): Effect.Effect<PrepareCommandResult, ValidationToolingFailure> =>
  Effect.gen(function* () {
    if (expectedHeadSha !== undefined) {
      yield* ensureCandidateIntegrity({
        commandExecutor,
        ...(commandCwd === undefined ? {} : { commandCwd }),
        expectedHeadSha,
        allowedUntrackedFiles: allowedUntrackedFiles ?? [],
      });
    }
    const result = yield* runRepositoryPreparationEffect({
      prepare,
      exec: commandExecutor,
      ...(commandCwd === undefined ? {} : { cwd: commandCwd }),
    });
    if (expectedHeadSha !== undefined) {
      yield* ensureCandidateIntegrity({
        commandExecutor,
        ...(commandCwd === undefined ? {} : { commandCwd }),
        expectedHeadSha,
        allowedUntrackedFiles: allowedUntrackedFiles ?? [],
      });
    }

    return {
      commandResult: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      timedOut: result.timedOut,
    };
  }).pipe(
    Effect.mapError((error) =>
      error instanceof GitToolingFailed
        ? error
        : new PrepareCommandExecutionToolingFailed({
            operationName: "run_prepare_command",
            command: prepare.command,
            message: error.message,
          }),
    ),
  );

const recordPrepareResult = (
  input: RunPreparePhaseInput,
  result: RecordCandidateValidationPrepareResultInput,
): Effect.Effect<void, RepositoryStorageError> => input.recordPrepareResult(result);

const prepareFinding = (
  validationRunId: number,
  prepare: ChangePrepareDefinition,
  commandResult: CommandResult,
  timedOut: boolean,
  artifactRefs: readonly string[],
): NonNullable<RecordCandidateValidationPrepareResultInput["finding"]> => ({
  validationRunId,
  phase: validationPhase.prepare,
  producer: prepareProducer,
  title: timedOut ? "Prepare timed out" : "Prepare failed",
  description: timedOut
    ? `Prepare command timed out after ${prepare.timeoutSeconds} seconds.`
    : `Prepare command exited with code ${commandResult.exitCode}.`,
  evidence: timedOut
    ? `command: ${prepare.command}\ntimeoutSeconds: ${prepare.timeoutSeconds}`
    : `command: ${prepare.command}\nexitCode: ${commandResult.exitCode}`,
  files: [],
  artifactRefs,
});

const writePrepareArtifacts = (input: {
  readonly validationRunId: number;
  readonly prepare: ChangePrepareDefinition;
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
}): Effect.Effect<ValidationCommandArtifacts, ValidationToolingFailure, FileSystem.FileSystem> =>
  writeCommandEvidence({
    validationRunId: input.validationRunId,
    phase: validationPhase.prepare,
    producer: prepareProducer,
    commandResult: { ...input.commandResult, timedOut: input.timedOut },
    durationMs: input.durationMs,
    logFields: [
      { name: "producer", value: prepareProducer },
      { name: "command", value: input.prepare.command },
      { name: "timeoutSeconds", value: input.prepare.timeoutSeconds },
    ],
    artifactsRoot: input.artifactsRoot,
    ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
  }).pipe(
    Effect.mapError(
      (error) =>
        new InfrastructureToolingFailed({
          operationName: "record_prepare_artifacts",
          message: errorMessage(error),
        }),
    ),
  );

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
