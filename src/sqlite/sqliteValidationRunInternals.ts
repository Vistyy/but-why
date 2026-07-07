import type { DatabaseSync } from "node:sqlite";

import type { RecordValidationRunToolingErrorInput } from "../validationRun/validationRunStore.js";
import { queryOne } from "./query.js";

export const recordValidationRunToolingErrorMutation = (
  database: DatabaseSync,
  input: RecordValidationRunToolingErrorInput,
): void => {
  database
    .prepare(`
      INSERT INTO validation_run_tooling_errors (
        validation_run_id,
        error_kind,
        operation_name,
        temp_ref_name,
        submitted_sha,
        worktree_path,
        error_message,
        cleanup_worktree,
        cleanup_temp_ref,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.validationRunId,
      input.errorKind,
      input.operationName,
      input.tempRefName,
      input.submittedSha,
      input.worktreePath ?? null,
      input.errorMessage,
      input.cleanupWorktree,
      input.cleanupTempRef,
      input.now,
    );

  database
    .prepare("UPDATE validation_runs SET status = 'error', updated_at = ? WHERE id = ?")
    .run(input.now, input.validationRunId);
};

export const validationRunExists = (database: DatabaseSync, validationRunId: string): boolean =>
  queryOne<ValidationRunIdRow>(database, "SELECT id FROM validation_runs WHERE id = ?", [
    validationRunId,
  ]) !== undefined;

type ValidationRunIdRow = {
  readonly id: string;
};
