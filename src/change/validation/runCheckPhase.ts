import type * as FileSystem from "@effect/platform/FileSystem";
import { Clock, Effect } from "effect";
import { runTimedCommand } from "../../command/runTimedCommand.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { runWithSubmitProgress, type SubmitProgress } from "../../submission/submissionProgress.js";
import type { RecordCandidateValidationCheckResultInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { SubmitCheckConfig } from "../submit/submitRepoConfig.js";
import { validationPhase } from "../validationRun/validationRun.js";
import { ensureCandidateIntegrity } from "./ensureCandidateIntegrity.js";
import {
  CheckCommandExecutionToolingFailed,
  GitToolingFailed,
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "./validationToolingFailures.js";
import { type ValidationCommandArtifacts, writeCommandEvidence } from "./writeCommandEvidence.js";

export type RunCheckPhaseInput = {
  readonly validationRunId: number;
  readonly checks: readonly SubmitCheckConfig[];
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd?: string;
  readonly expectedHeadSha?: string;
  readonly allowedUntrackedFiles?: readonly string[];
  readonly progress?: SubmitProgress;
  readonly now: string;
  readonly continueAfterFinding?: boolean;
  readonly recordCheckResult: (
    input: RecordCandidateValidationCheckResultInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type RunCheckPhaseResult =
  | {
      readonly ok: true;
      readonly findings: 0;
    }
  | {
      readonly ok: true;
      readonly findings: 1;
      readonly validationRunId: number;
    };

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type CheckCommandResult = {
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
};

type CheckResult = {
  readonly producer: string;
  readonly failed: boolean;
  readonly artifactRecords: RecordCandidateValidationCheckResultInput["artifactRecords"];
  readonly finding?: NonNullable<RecordCandidateValidationCheckResultInput["finding"]>;
};

export const runCheckPhase = (
  input: RunCheckPhaseInput,
): Effect.Effect<
  RunCheckPhaseResult,
  ValidationToolingFailure | RepositoryStorageError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    let foundFailure = false;

    for (const check of input.checks) {
      const checkResult: CheckResult = yield* runWithSubmitProgress({
        progress: input.progress,
        phase: { kind: "check", id: check.id },
        run: Effect.gen(function* () {
          const checkResult = yield* runSingleCheck(input, check);
          yield* recordCheckResult(input, checkResult);
          return checkResult;
        }),
        outcome: (result) => (result.failed ? "failed" : "passed"),
        details: (result) => (result.failed ? { reason: "findings" } : undefined),
      });
      foundFailure ||= checkResult.failed;

      if (checkResult.failed && input.continueAfterFinding !== true) {
        return { ok: true, findings: 1, validationRunId: input.validationRunId };
      }
    }

    return foundFailure
      ? { ok: true, findings: 1, validationRunId: input.validationRunId }
      : { ok: true, findings: 0 };
  });

const runSingleCheck = (
  input: RunCheckPhaseInput,
  check: SubmitCheckConfig,
): Effect.Effect<CheckResult, ValidationToolingFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const { commandResult, timedOut } = yield* runCheckCommand(
      input.commandExecutor,
      check,
      input.commandCwd,
      input.expectedHeadSha,
      input.allowedUntrackedFiles,
    );
    const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
    const { artifactRefs, artifactRecords } = yield* writeCheckArtifacts({
      validationRunId: input.validationRunId,
      check,
      commandResult,
      timedOut,
      durationMs,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      now: input.now,
    });
    const failed = commandResult.exitCode !== 0;

    return {
      producer: check.id,
      failed,
      artifactRecords,
      ...(failed
        ? {
            finding: checkFinding(
              input.validationRunId,
              check,
              commandResult,
              timedOut,
              artifactRefs,
            ),
          }
        : {}),
    };
  });

const recordCheckResult = (
  input: RunCheckPhaseInput,
  result: CheckResult,
): Effect.Effect<void, RepositoryStorageError> =>
  input.recordCheckResult({
    validationRunId: input.validationRunId,
    producer: result.producer,
    outcome: result.failed ? "failed" : "passed",
    artifactRecords: result.artifactRecords,
    ...(result.finding === undefined ? {} : { finding: result.finding }),
    now: input.now,
  });

const checkFinding = (
  validationRunId: number,
  check: SubmitCheckConfig,
  commandResult: CommandResult,
  timedOut: boolean,
  artifactRefs: readonly string[],
): NonNullable<RecordCandidateValidationCheckResultInput["finding"]> => ({
  validationRunId,
  phase: validationPhase.checks,
  producer: check.id,
  title: timedOut ? `Check timed out: ${check.id}` : `Check failed: ${check.id}`,
  description: timedOut
    ? `Configured check ${check.id} timed out after ${check.timeoutSeconds} seconds.`
    : `Configured check ${check.id} exited with code ${commandResult.exitCode}.`,
  evidence: timedOut
    ? `command: ${check.command}\ntimeoutSeconds: ${check.timeoutSeconds}`
    : `command: ${check.command}\nexitCode: ${commandResult.exitCode}`,
  files: [],
  artifactRefs,
});

const runCheckCommand = (
  commandExecutor: WorkspaceCommandExecutor,
  check: SubmitCheckConfig,
  commandCwd: string | undefined,
  expectedHeadSha: string | undefined,
  allowedUntrackedFiles: readonly string[] | undefined,
): Effect.Effect<CheckCommandResult, ValidationToolingFailure> =>
  Effect.gen(function* () {
    if (expectedHeadSha !== undefined) {
      yield* ensureCandidateIntegrity({
        commandExecutor,
        ...(commandCwd === undefined ? {} : { commandCwd }),
        expectedHeadSha,
        allowedUntrackedFiles: allowedUntrackedFiles ?? [],
      });
    }
    const result = yield* runTimedCommand({
      command: check.command,
      timeoutSeconds: check.timeoutSeconds,
      completionMarker: checkCompletionMarker(check.id),
      missingTimeoutMessage: `Could not find timeout command for check ${check.id}.`,
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
        : new CheckCommandExecutionToolingFailed({
            operationName: "run_check_command",
            command: check.command,
            message: error.message,
          }),
    ),
  );

const writeCheckArtifacts = (input: {
  readonly validationRunId: number;
  readonly check: SubmitCheckConfig;
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly now: string;
}): Effect.Effect<ValidationCommandArtifacts, ValidationToolingFailure, FileSystem.FileSystem> =>
  writeCommandEvidence({
    validationRunId: input.validationRunId,
    phase: validationPhase.checks,
    producer: input.check.id,
    commandResult: { ...input.commandResult, timedOut: input.timedOut },
    durationMs: input.durationMs,
    logFields: [
      { name: "checkId", value: input.check.id },
      { name: "command", value: input.check.command },
      { name: "timeoutSeconds", value: input.check.timeoutSeconds },
    ],
    artifactsRoot: input.artifactsRoot,
    ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
  }).pipe(
    Effect.mapError(
      (error) =>
        new InfrastructureToolingFailed({
          operationName: "record_check_artifacts",
          message: errorMessage(error),
        }),
    ),
  );

const checkCompletionMarker = (checkId: string): string => `__BUTWHY_CHECK_COMPLETED_${checkId}__`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
