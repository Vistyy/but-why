import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import { runRepositoryPreparation } from "../../repositoryPreparation/runRepositoryPreparation.js";
import type { SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import { writeCommandEvidence } from "./writeCommandEvidence.js";
import { validationPhase } from "../validationRun/validationRun.js";
import type { RecordCandidateValidationPrepareRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { ensureCandidateIntegrity } from "./ensureCandidateIntegrity.js";
import {
  GitToolingFailed,
  InfrastructureToolingFailed,
  PrepareCommandExecutionToolingFailed,
  type ValidationToolingFailure,
} from "./validationToolingFailures.js";

export type RunPreparePhaseInput = {
  readonly validationRunId: string;
  readonly prepare: SubmitPrepareConfig;
  readonly sandbox: Pick<Sandbox, "exec">;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd?: string;
  readonly expectedHeadSha?: string;
  readonly allowedUntrackedFiles?: readonly string[];
  readonly now: string;
  readonly recordPrepareRound: (
    input: RecordCandidateValidationPrepareRoundInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type RunPreparePhaseResult =
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

type PrepareCommandResult = {
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
};

const prepareProducer = "prepare";
export const runPreparePhase = (
  input: RunPreparePhaseInput,
): Effect.Effect<RunPreparePhaseResult, ValidationToolingFailure | RepositoryStorageError> =>
  Effect.gen(function* () {
    const { commandResult, timedOut } = yield* runPrepareCommand(
      input.sandbox,
      input.prepare,
      input.commandCwd,
      input.expectedHeadSha,
      input.allowedUntrackedFiles,
    );
    const { artifactRefs, artifactRecords } = yield* writePrepareArtifacts({
      validationRunId: input.validationRunId,
      prepare: input.prepare,
      commandResult,
      timedOut,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      now: input.now,
    });
    const failed = commandResult.exitCode !== 0;

    yield* recordPrepareRound(input, {
      validationRunId: input.validationRunId,
      roundNumber: 1,
      roundStatus: failed ? "failed" : "passed",
      phaseStatus: failed ? "failed" : "passed",
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
      now: input.now,
    });

    if (failed) {
      return { ok: true, findings: 1, validationRunId: input.validationRunId };
    }

    return { ok: true, findings: 0 };
  });

const runPrepareCommand = (
  sandbox: Pick<Sandbox, "exec">,
  prepare: SubmitPrepareConfig,
  commandCwd: string | undefined,
  expectedHeadSha: string | undefined,
  allowedUntrackedFiles: readonly string[] | undefined,
): Effect.Effect<PrepareCommandResult, ValidationToolingFailure> =>
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
      const result = await runRepositoryPreparation({
        prepare,
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
        : new PrepareCommandExecutionToolingFailed({
            operationName: "run_prepare_command",
            command: prepare.command,
            message: errorMessage(error),
          }),
  });

const recordPrepareRound = (
  input: RunPreparePhaseInput,
  prepareRound: RecordCandidateValidationPrepareRoundInput,
): Effect.Effect<void, RepositoryStorageError> => input.recordPrepareRound(prepareRound);

const prepareFinding = (
  validationRunId: string,
  prepare: SubmitPrepareConfig,
  commandResult: CommandResult,
  timedOut: boolean,
  artifactRefs: readonly string[],
): NonNullable<RecordCandidateValidationPrepareRoundInput["finding"]> => ({
  id: `${validationRunId}-F1`,
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
  readonly validationRunId: string;
  readonly prepare: SubmitPrepareConfig;
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
        phase: validationPhase.prepare,
        producer: prepareProducer,
        commandResult: { ...input.commandResult, timedOut: input.timedOut },
        logFields: [
          { name: "producer", value: prepareProducer },
          { name: "command", value: input.prepare.command },
          { name: "timeoutSeconds", value: input.prepare.timeoutSeconds },
        ],
        artifactsRoot: input.artifactsRoot,
        ...(input.artifactMaxBytes === undefined
          ? {}
          : { artifactMaxBytes: input.artifactMaxBytes }),
      }),
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_prepare_artifacts",
        message: errorMessage(error),
      }),
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
