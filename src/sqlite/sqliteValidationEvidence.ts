import type { DatabaseSync } from "node:sqlite";

import { encodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import type { RecordCandidateValidationCommandRoundInput } from "../candidateValidation/candidateValidationRunStore.js";

export const recordValidationEvidenceMutation = (
  database: DatabaseSync,
  input: RecordCandidateValidationCommandRoundInput,
  tables: { readonly artifacts: string; readonly findings: string },
): void => {
  for (const artifact of input.artifactRecords) {
    database
      .prepare(
        `INSERT INTO ${tables.artifacts} (ref, validation_run_id, phase, producer, path, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.ref,
        artifact.validationRunId,
        artifact.phase,
        artifact.producer,
        artifact.path,
        input.now,
      );
  }
  const findings = input.findings ?? (input.finding === undefined ? [] : [input.finding]);
  for (const finding of findings) {
    database
      .prepare(
        `INSERT INTO ${tables.findings} (id, validation_run_id, phase, producer, title, description, severity, evidence, files, artifact_refs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        finding.id,
        finding.validationRunId,
        finding.phase,
        finding.producer,
        finding.title,
        finding.description,
        finding.severity ?? null,
        finding.evidence,
        encodeSqliteJsonStringArray(finding.files),
        encodeSqliteJsonStringArray(finding.artifactRefs),
        input.now,
        input.now,
      );
  }
};
