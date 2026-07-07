import type { DatabaseSync } from "node:sqlite";

import type { RecordRunToolingErrorInput } from "../run/runStore.js";
import { queryOne } from "./query.js";

export const recordRunToolingErrorMutation = (
  database: DatabaseSync,
  input: RecordRunToolingErrorInput,
): void => {
  database
    .prepare(`
      INSERT INTO run_tooling_errors (
        run_id,
        operation_name,
        temp_ref_name,
        submitted_sha,
        worktree_path,
        error_message,
        cleanup_worktree,
        cleanup_temp_ref,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.runId,
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
    .prepare("UPDATE runs SET status = 'error', updated_at = ? WHERE id = ?")
    .run(input.now, input.runId);
};

export const runExists = (database: DatabaseSync, runId: string): boolean =>
  queryOne<RunIdRow>(database, "SELECT id FROM runs WHERE id = ?", [runId]) !== undefined;

type RunIdRow = {
  readonly id: string;
};
