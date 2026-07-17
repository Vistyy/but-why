import type { DatabaseSync } from "node:sqlite";

import { encodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import type { RecordValidationRunCommandRoundInput } from "../validationRun/validationRunStore.js";

export const recordValidationEvidenceMutation = (
  database: DatabaseSync,
  input: RecordValidationRunCommandRoundInput,
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
  if (input.finding !== undefined) {
    database
      .prepare(
        `INSERT INTO ${tables.findings} (id, validation_run_id, phase, producer, title, description, severity, evidence, files, artifact_refs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.finding.id,
        input.finding.validationRunId,
        input.finding.phase,
        input.finding.producer,
        input.finding.title,
        input.finding.description,
        input.finding.severity ?? null,
        input.finding.evidence,
        encodeSqliteJsonStringArray(input.finding.files),
        encodeSqliteJsonStringArray(input.finding.artifactRefs),
        input.now,
        input.now,
      );
  }
};
