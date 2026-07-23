import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { SubmitCheckConfig } from "../submit/submitRepoConfig.js";
import { ensureCandidateIntegrity } from "./ensureCandidateIntegrity.js";
import { runValidationCommand } from "./runValidationCommand.js";
import { writeCommandEvidence } from "./writeCommandEvidence.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { RecordCandidateValidationCheckRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  CheckCommandExecutionToolingFailed,
  GitToolingFailed,
  InfrastructureToolingFailed,
  type ValidationToolingFailure,
} from "./validationToolingFailures.js";

export type RunCheckPhaseInput = {
  readonly validationRunId: string;
  readonly checks: readonly SubmitCheckConfig[];
  readonly sandbox: Pick<Sandbox, "exec">;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd?: string;
  readonly expectedHeadSha?: string;
  readonly allowedUntrackedFiles?: readonly string[];
  readonly now: string;
  readonly continueAfterFinding?: boolean;
  readonly recordCheckRound: (
    input: RecordCandidateValidationCheckRoundInput,
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
      readonly validationRunId: string;
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

type CheckRound = {
  readonly producer: string;
  readonly roundNumber: number;
  readonly failed: boolean;
  readonly lastCheck: boolean;
  readonly priorFailure: boolean;
  readonly artifactRecords: RecordCandidateValidationCheckRoundInput["artifactRecords"];
  readonly finding?: NonNullable<RecordCandidateValidationCheckRoundInput["finding"]>;
};

export const runCheckPhase = (
  input: RunCheckPhaseInput,
): Effect.Effect<RunCheckPhaseResult, ValidationToolingFailure | RepositoryStorageError> =>
  Effect.gen(function* () {
    let foundFailure = false;

    for (const [index, check] of input.checks.entries()) {
      const checkRound: CheckRound = yield* runSingleCheck(input, check, index, foundFailure);

      yield* recordCheckRound(input, checkRound);
      foundFailure ||= checkRound.failed;

      if (checkRound.failed && input.continueAfterFinding !== true) {
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
  index: number,
  priorFailure: boolean,
): Effect.Effect<CheckRound, ValidationToolingFailure> =>
  Effect.gen(function* () {
    const { commandResult, timedOut } = yield* runCheckCommand(
      input.sandbox,
      check,
      input.commandCwd,
      input.expectedHeadSha,
      input.allowedUntrackedFiles,
    );
    const { artifactRefs, artifactRecords } = yield* writeCheckArtifacts({
      validationRunId: input.validationRunId,
      check,
      commandResult,
      timedOut,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      now: input.now,
    });
    const failed = commandResult.exitCode !== 0;

    return {
      producer: check.id,
      roundNumber: index + 1,
      failed,
      lastCheck: index === input.checks.length - 1,
      priorFailure,
      artifactRecords,
      ...(failed
        ? {
            finding: checkFinding(
              input.validationRunId,
              index + 1,
              check,
              commandResult,
              timedOut,
              artifactRefs,
            ),
          }
        : {}),
    };
  });

const recordCheckRound = (
  input: RunCheckPhaseInput,
  checkRound: CheckRound,
): Effect.Effect<void, RepositoryStorageError> =>
  input.recordCheckRound({
    validationRunId: input.validationRunId,
    producer: checkRound.producer,
    roundNumber: checkRound.roundNumber,
    roundStatus: checkRound.failed ? "failed" : "passed",
    phaseStatus:
      checkRound.failed || (checkRound.lastCheck && checkRound.priorFailure)
        ? "failed"
        : checkRound.lastCheck
          ? "passed"
          : "active",
    artifactRecords: checkRound.artifactRecords,
    ...(checkRound.finding === undefined ? {} : { finding: checkRound.finding }),
    now: input.now,
  });

const checkFinding = (
  validationRunId: string,
  findingNumber: number,
  check: SubmitCheckConfig,
  commandResult: CommandResult,
  timedOut: boolean,
  artifactRefs: readonly string[],
): NonNullable<RecordCandidateValidationCheckRoundInput["finding"]> => ({
  id: `${validationRunId}-F${findingNumber}`,
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
  sandbox: Pick<Sandbox, "exec">,
  check: SubmitCheckConfig,
  commandCwd: string | undefined,
  expectedHeadSha: string | undefined,
  allowedUntrackedFiles: readonly string[] | undefined,
): Effect.Effect<CheckCommandResult, ValidationToolingFailure> =>
  Effect.tryPromise({
    try: async () => {
      if (expectedHeadSha !== undefined) {
        await ensureCandidateIntegrity({
          sandbox,
          ...(commandCwd === undefined ? {} : { commandCwd }),
          expectedHeadSha,
          allowedUntrackedFiles: allowedUntrackedFiles ?? [],
        });
      }
      const result = await runValidationCommand({
        command: check.command,
        timeoutSeconds: check.timeoutSeconds,
        completionMarker: checkCompletionMarker(check.id),
        missingTimeoutMessage: `Could not find timeout command for check ${check.id}.`,
        exec: (command, options) => sandbox.exec(command, options),
        ...(commandCwd === undefined ? {} : { cwd: commandCwd }),
      });
      if (expectedHeadSha !== undefined) {
        await ensureCandidateIntegrity({
          sandbox,
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
    },
    catch: (error) =>
      error instanceof GitToolingFailed
        ? error
        : new CheckCommandExecutionToolingFailed({
            operationName: "run_check_command",
            command: check.command,
            message: errorMessage(error),
          }),
  });

const writeCheckArtifacts = (input: {
  readonly validationRunId: string;
  readonly check: SubmitCheckConfig;
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly now: string;
}): Effect.Effect<ReturnType<typeof writeCommandEvidence>, ValidationToolingFailure> =>
  Effect.try({
    try: () =>
      writeCommandEvidence({
        validationRunId: input.validationRunId,
        phase: validationPhase.checks,
        producer: input.check.id,
        commandResult: { ...input.commandResult, timedOut: input.timedOut },
        logFields: [
          { name: "checkId", value: input.check.id },
          { name: "command", value: input.check.command },
          { name: "timeoutSeconds", value: input.check.timeoutSeconds },
        ],
        artifactsRoot: input.artifactsRoot,
        ...(input.artifactMaxBytes === undefined
          ? {}
          : { artifactMaxBytes: input.artifactMaxBytes }),
      }),
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_check_artifacts",
        message: errorMessage(error),
      }),
  });

const checkCompletionMarker = (checkId: string): string => `__BUTWHY_CHECK_COMPLETED_${checkId}__`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
