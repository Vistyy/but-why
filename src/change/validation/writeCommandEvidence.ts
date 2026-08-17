import type { PlatformError } from "@effect/platform/Error";
import type * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import type { RecordCandidateValidationPhaseResultInput } from "../candidateValidation/candidateValidationRunStore.js";
import { writeValidationRunArtifactFile } from "../validationRun/artifactFiles.js";
import type { ValidationPhase } from "../validationRun/validationRun.js";

export type ValidationCommandArtifacts = {
  readonly artifactRecords: readonly RecordCandidateValidationPhaseResultInput["artifactRecords"][number][];
  readonly artifactRefs: readonly string[];
};

export type ValidationCommandEvidence = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

const artifactFileNames = [
  "stdout.txt",
  "stderr.txt",
  "exit-code.json",
  "logs.txt",
  "execution.json",
] as const;

export const writeCommandEvidence = (input: {
  readonly validationRunId: number;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly commandResult: ValidationCommandEvidence;
  readonly durationMs: number;
  readonly logFields: readonly { readonly name: string; readonly value: string | number }[];
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
}): Effect.Effect<ValidationCommandArtifacts, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const artifacts = [
      { fileName: "stdout.txt", content: input.commandResult.stdout },
      { fileName: "stderr.txt", content: input.commandResult.stderr },
      {
        fileName: "exit-code.json",
        content: [
          "{",
          `  "exitCode": ${input.commandResult.exitCode},`,
          `  "timedOut": ${input.commandResult.timedOut}`,
          "}",
          "",
        ].join("\n"),
      },
      {
        fileName: "logs.txt",
        content: [
          ...input.logFields.map((field) => `${field.name}: ${field.value}`),
          `exitCode: ${input.commandResult.exitCode}`,
          `timedOut: ${input.commandResult.timedOut}`,
          "",
        ].join("\n"),
      },
      {
        fileName: "execution.json",
        content: `${JSON.stringify({ durationMs: input.durationMs }, null, 2)}\n`,
      },
    ] as const;

    const artifactRecords = [];
    for (const artifact of artifacts) {
      const artifactFile = yield* writeValidationRunArtifactFile({
        artifactsRoot: input.artifactsRoot,
        validationRunId: input.validationRunId,
        phase: input.phase,
        producer: input.producer,
        fileName: artifact.fileName,
        content: artifact.content,
        ...(input.artifactMaxBytes === undefined ? {} : { maxBytes: input.artifactMaxBytes }),
      });
      artifactRecords.push({
        ref: artifactRef(input.validationRunId, input.phase, input.producer, artifact.fileName),
        validationRunId: input.validationRunId,
        phase: input.phase,
        producer: input.producer,
        ...artifactFile,
      });
    }

    return {
      artifactRecords,
      artifactRefs: artifactFileNames.map((fileName) =>
        artifactRef(input.validationRunId, input.phase, input.producer, fileName),
      ),
    };
  });

const artifactRef = (
  validationRunId: number,
  phase: ValidationPhase,
  producer: string,
  fileName: string,
): string => `artifact:${validationRunId}/${phase}/${producer}/${fileName}`;
