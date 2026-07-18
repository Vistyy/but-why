import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import { runRepositoryPreparation } from "../repositoryPreparation/runRepositoryPreparation.js";
import type { SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import { writeValidationRunArtifactFile } from "../validationRun/artifactFiles.js";
import type { RecordValidationRunPrepareRoundInput } from "../validationRun/validationRunStore.js";
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
  readonly recordPrepareRound: (input: RecordValidationRunPrepareRoundInput) => void;
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
const artifactFileNames = ["stdout.txt", "stderr.txt", "exit-code.json", "logs.txt"] as const;

export const runPreparePhase = (
  input: RunPreparePhaseInput,
): Effect.Effect<RunPreparePhaseResult, ValidationToolingFailure> =>
  Effect.gen(function* () {
    const { commandResult, timedOut } = yield* runPrepareCommand(
      input.sandbox,
      input.prepare,
      input.commandCwd,
      input.expectedHeadSha,
      input.allowedUntrackedFiles,
    );
    const artifactRefs = artifactFileNames.map((fileName) =>
      prepareArtifactRef(input.validationRunId, fileName),
    );
    const artifactRecords = yield* writePrepareArtifacts({
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
      await ensureCandidateIntegrity(sandbox, commandCwd, expectedHeadSha, allowedUntrackedFiles);
      const result = await runRepositoryPreparation({
        prepare,
        exec: (command, options) => sandbox.exec(command, options),
        ...(commandCwd === undefined ? {} : { cwd: commandCwd }),
      });
      await ensureCandidateIntegrity(sandbox, commandCwd, expectedHeadSha, allowedUntrackedFiles);
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

const ensureCandidateIntegrity = async (
  sandbox: Pick<Sandbox, "exec">,
  commandCwd: string | undefined,
  expectedHeadSha: string | undefined,
  allowedUntrackedFiles: readonly string[] | undefined,
): Promise<void> => {
  if (expectedHeadSha === undefined) return;
  const result = await sandbox.exec(
    "git rev-parse HEAD && git diff --quiet && git diff --cached --quiet && git status --porcelain --untracked-files=all",
    commandCwd === undefined ? undefined : { cwd: commandCwd },
  );
  const [head, ...status] = result.stdout.trimEnd().split("\n");
  if (
    result.exitCode !== 0 ||
    head !== expectedHeadSha ||
    !status.every(
      (line) => line.startsWith("?? ") && allowedUntrackedFiles?.includes(line.slice(3)) === true,
    )
  ) {
    throw new GitToolingFailed({
      operationName: "verify_candidate_head",
      message: "Validation workspace no longer matches the Candidate.",
    });
  }
};

const recordPrepareRound = (
  input: RunPreparePhaseInput,
  prepareRound: RecordValidationRunPrepareRoundInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  Effect.try({
    try: () => {
      input.recordPrepareRound(prepareRound);
    },
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_prepare_round",
        message: errorMessage(error),
      }),
  });

const prepareFinding = (
  validationRunId: string,
  prepare: SubmitPrepareConfig,
  commandResult: CommandResult,
  timedOut: boolean,
  artifactRefs: readonly string[],
): NonNullable<RecordValidationRunPrepareRoundInput["finding"]> => ({
  id: `${validationRunId}-F1`,
  validationRunId,
  phase: "prepare",
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
}): Effect.Effect<
  readonly RecordValidationRunPrepareRoundInput["artifactRecords"][number][],
  ValidationToolingFailure
> =>
  Effect.try({
    try: () => {
      const artifacts = [
        { fileName: "stdout.txt", content: input.commandResult.stdout },
        { fileName: "stderr.txt", content: input.commandResult.stderr },
        {
          fileName: "exit-code.json",
          content: [
            "{",
            `  "exitCode": ${input.commandResult.exitCode},`,
            `  "timedOut": ${input.timedOut}`,
            "}",
            "",
          ].join("\n"),
        },
        {
          fileName: "logs.txt",
          content: prepareLogContent(input.prepare, input.commandResult, input.timedOut),
        },
      ] as const;

      return artifacts.map((artifact) => {
        const artifactFile = writeValidationRunArtifactFile({
          artifactsRoot: input.artifactsRoot,
          validationRunId: input.validationRunId,
          phase: "prepare",
          producer: prepareProducer,
          fileName: artifact.fileName,
          content: artifact.content,
          ...(input.artifactMaxBytes === undefined ? {} : { maxBytes: input.artifactMaxBytes }),
        });

        return {
          ref: prepareArtifactRef(input.validationRunId, artifact.fileName),
          validationRunId: input.validationRunId,
          phase: "prepare" as const,
          producer: prepareProducer,
          ...artifactFile,
        };
      });
    },
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_prepare_artifacts",
        message: errorMessage(error),
      }),
  });

const prepareArtifactRef = (validationRunId: string, fileName: string): string =>
  `artifact:${validationRunId}/prepare/prepare/${fileName}`;

const prepareLogContent = (
  prepare: SubmitPrepareConfig,
  commandResult: CommandResult,
  timedOut: boolean,
): string =>
  [
    "producer: prepare",
    `command: ${prepare.command}`,
    `timeoutSeconds: ${prepare.timeoutSeconds}`,
    `exitCode: ${commandResult.exitCode}`,
    `timedOut: ${timedOut}`,
    "",
  ].join("\n");

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
