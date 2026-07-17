import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { SubmitCheckConfig } from "../submit/submitRepoConfig.js";
import { writeValidationRunArtifactFile } from "../validationRun/artifactFiles.js";
import type { RecordValidationRunCheckRoundInput } from "../validationRun/validationRunStore.js";
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
  readonly recordCheckRound: (input: RecordValidationRunCheckRoundInput) => void;
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
  readonly artifactRecords: RecordValidationRunCheckRoundInput["artifactRecords"];
  readonly finding?: NonNullable<RecordValidationRunCheckRoundInput["finding"]>;
};

const timeoutExitCode = 124;
const artifactFileNames = ["stdout.txt", "stderr.txt", "exit-code.json", "logs.txt"] as const;

export const runCheckPhase = (
  input: RunCheckPhaseInput,
): Effect.Effect<RunCheckPhaseResult, ValidationToolingFailure> =>
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
    const artifactRefs = artifactFileNames.map((fileName) =>
      checkArtifactRef(input.validationRunId, check.id, fileName),
    );
    const artifactRecords = yield* writeCheckArtifacts({
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
): Effect.Effect<void, ValidationToolingFailure> =>
  Effect.try({
    try: () => {
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
    },
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_check_round",
        message: errorMessage(error),
      }),
  });

const checkFinding = (
  validationRunId: string,
  findingNumber: number,
  check: SubmitCheckConfig,
  commandResult: CommandResult,
  timedOut: boolean,
  artifactRefs: readonly string[],
): NonNullable<RecordValidationRunCheckRoundInput["finding"]> => ({
  id: `${validationRunId}-F${findingNumber}`,
  validationRunId,
  phase: "checks",
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
      await ensureCandidateIntegrity(sandbox, commandCwd, expectedHeadSha, allowedUntrackedFiles);
      await ensureTimeoutCommandAvailable(sandbox, check);

      const marker = checkCompletionMarker(check.id);
      const result = await sandbox.exec(
        timeoutWrappedCommand(check, marker),
        commandCwd === undefined ? undefined : { cwd: commandCwd },
      );
      const parsed = parseCheckCompletionMarker(result.stderr, marker);
      await ensureCandidateIntegrity(sandbox, commandCwd, expectedHeadSha, allowedUntrackedFiles);

      return {
        commandResult: {
          exitCode: parsed.completed ? parsed.exitCode : timeoutExitCode,
          stdout: result.stdout,
          stderr: parsed.stderr,
        },
        timedOut: !parsed.completed,
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
    !status.every((line) => allowedUntrackedFiles?.includes(line.slice(3)) === true)
  ) {
    throw new GitToolingFailed({
      operationName: "verify_candidate_head",
      message: "Validation workspace no longer matches the Candidate.",
    });
  }
};

const ensureTimeoutCommandAvailable = async (
  sandbox: Pick<Sandbox, "exec">,
  check: SubmitCheckConfig,
): Promise<void> => {
  const result = await sandbox.exec("command -v timeout >/dev/null 2>&1");

  if (result.exitCode !== 0) {
    throw new Error(`Could not find timeout command for check ${check.id}.`);
  }
};

const writeCheckArtifacts = (input: {
  readonly validationRunId: string;
  readonly check: SubmitCheckConfig;
  readonly commandResult: CommandResult;
  readonly timedOut: boolean;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly now: string;
}): Effect.Effect<
  readonly RecordValidationRunCheckRoundInput["artifactRecords"][number][],
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
          content: checkLogContent(input.check, input.commandResult, input.timedOut),
        },
      ] as const;

      return artifacts.map((artifact) => {
        const artifactFile = writeValidationRunArtifactFile({
          artifactsRoot: input.artifactsRoot,
          validationRunId: input.validationRunId,
          phase: "checks",
          producer: input.check.id,
          fileName: artifact.fileName,
          content: artifact.content,
          ...(input.artifactMaxBytes === undefined ? {} : { maxBytes: input.artifactMaxBytes }),
        });

        return {
          ref: checkArtifactRef(input.validationRunId, input.check.id, artifact.fileName),
          validationRunId: input.validationRunId,
          phase: "checks" as const,
          producer: input.check.id,
          ...artifactFile,
        };
      });
    },
    catch: (error) =>
      new InfrastructureToolingFailed({
        operationName: "record_check_artifacts",
        message: errorMessage(error),
      }),
  });

const checkArtifactRef = (validationRunId: string, checkId: string, fileName: string): string =>
  `artifact:${validationRunId}/checks/${checkId}/${fileName}`;

const timeoutWrappedCommand = (check: SubmitCheckConfig, marker: string): string =>
  [
    `timeout ${check.timeoutSeconds}s sh -c`,
    shellQuote(`sh -c "$1"
check_exit_code=$?
printf '\n%s:%s\n' "$2" "$check_exit_code" >&2
exit "$check_exit_code"`),
    "_",
    shellQuote(check.command),
    shellQuote(marker),
  ].join(" ");

const parseCheckCompletionMarker = (
  stderr: string,
  marker: string,
):
  | { readonly completed: true; readonly exitCode: number; readonly stderr: string }
  | { readonly completed: false; readonly stderr: string } => {
  const markerMatch = stderr.match(new RegExp(`\\n${marker}:(\\d+)\\n?$`));

  if (markerMatch === null) {
    return { completed: false, stderr };
  }

  return {
    completed: true,
    exitCode: Number(markerMatch[1]),
    stderr: stderr.slice(0, markerMatch.index),
  };
};

const checkCompletionMarker = (checkId: string): string => `__BUTWHY_CHECK_COMPLETED_${checkId}__`;

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const checkLogContent = (
  check: SubmitCheckConfig,
  commandResult: CommandResult,
  timedOut: boolean,
): string =>
  [
    `checkId: ${check.id}`,
    `command: ${check.command}`,
    `timeoutSeconds: ${check.timeoutSeconds}`,
    `exitCode: ${commandResult.exitCode}`,
    `timedOut: ${timedOut}`,
    "",
  ].join("\n");

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
