import type { RecordCandidateValidationCommandRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import { writeValidationRunArtifactFile } from "../validationRun/artifactFiles.js";
import type { ValidationPhase } from "../validationRun/validationRun.js";

export type ValidationCommandEvidence = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

const artifactFileNames = ["stdout.txt", "stderr.txt", "exit-code.json", "logs.txt"] as const;

export const writeCommandEvidence = (input: {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly commandResult: ValidationCommandEvidence;
  readonly logFields: readonly { readonly name: string; readonly value: string | number }[];
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
}): {
  readonly artifactRecords: readonly RecordCandidateValidationCommandRoundInput["artifactRecords"][number][];
  readonly artifactRefs: readonly string[];
} => {
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
  ] as const;

  const artifactRecords = artifacts.map((artifact) => {
    const artifactFile = writeValidationRunArtifactFile({
      artifactsRoot: input.artifactsRoot,
      validationRunId: input.validationRunId,
      phase: input.phase,
      producer: input.producer,
      fileName: artifact.fileName,
      content: artifact.content,
      ...(input.artifactMaxBytes === undefined ? {} : { maxBytes: input.artifactMaxBytes }),
    });
    return {
      ref: artifactRef(input.validationRunId, input.phase, input.producer, artifact.fileName),
      validationRunId: input.validationRunId,
      phase: input.phase,
      producer: input.producer,
      ...artifactFile,
    };
  });

  return {
    artifactRecords,
    artifactRefs: artifactFileNames.map((fileName) =>
      artifactRef(input.validationRunId, input.phase, input.producer, fileName),
    ),
  };
};

const artifactRef = (
  validationRunId: string,
  phase: ValidationPhase,
  producer: string,
  fileName: string,
): string => `artifact:${validationRunId}/${phase}/${producer}/${fileName}`;
