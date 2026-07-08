import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryOne } from "./query.js";
import { encodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import {
  recordValidationRunToolingErrorMutation,
  validationRunExists,
} from "./sqliteValidationRunInternals.js";
import { submitStateReadiness } from "../task/submitPolicy.js";
import { storedPublicTaskId, taskSlugForId, type PublicTaskId } from "../task/taskId.js";
import type { TaskState } from "../task/lifecycle.js";
import { validationToolingFailureRecord } from "../validation/validationToolingFailures.js";
import type { RecordValidationRunCheckRoundInput } from "../validationRun/validationRunStore.js";
import type {
  RecordValidationCheckRoundResult,
  RecordValidationToolingFailureInput,
  RecordValidationToolingFailureResult,
  StartValidationRunInput,
  StartValidationRunResult,
  ValidationRuns,
} from "../validation/validationRuns.js";

export const openSqliteValidationRuns = (input: SqliteStoreInput): ValidationRuns => ({
  start: (startInput) =>
    withStateDatabase(input, (database) => startValidationRun(database, startInput)),
  recordToolingFailure: (toolingErrorInput) =>
    withStateDatabase(input, (database) => recordToolingFailure(database, toolingErrorInput)),
  recordCheckRound: (checkRoundInput) =>
    withStateDatabase(input, (database) => recordCheckRound(database, checkRoundInput)),
});

const startValidationRun = (
  database: DatabaseSync,
  input: StartValidationRunInput,
): StartValidationRunResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const task = getTaskForSubmit(database, input.taskId);

    if (task === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_NOT_FOUND" };
    }

    const readiness = submitStateReadiness(task.state);

    if (!readiness.ok) {
      database.exec("ROLLBACK");
      return readiness;
    }

    const activeValidationRun = queryOne<ValidationRunIdRow>(
      database,
      "SELECT id FROM validation_runs WHERE task_id = ? AND status = 'active' LIMIT 1",
      [input.taskId],
    );

    if (activeValidationRun !== undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_HAS_ACTIVE_VALIDATION_RUN" };
    }

    if (task.branch !== null && task.branch !== input.branch) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_BRANCH_MISMATCH", boundBranch: task.branch };
    }

    if (task.branch === null) {
      const branchOwner = queryOne<TaskIdRow>(
        database,
        "SELECT id FROM tasks WHERE branch = ? AND id <> ? LIMIT 1",
        [input.branch, input.taskId],
      );

      if (branchOwner !== undefined) {
        database.exec("ROLLBACK");
        return { ok: false, code: "BRANCH_ALREADY_BOUND", boundTaskId: branchOwner.id };
      }
    }

    const taskValidationNumber = nextTaskValidationNumber(database, input.taskId);
    const validationRunId = `${taskSlugForId(input.taskId)}.v${taskValidationNumber}`;

    if (task.branch === null) {
      database.prepare("UPDATE tasks SET branch = ? WHERE id = ?").run(input.branch, input.taskId);
    }

    database
      .prepare(`
        INSERT INTO validation_runs (
          id,
          task_id,
          task_validation_number,
          status,
          branch,
          commit_sha,
          github_owner,
          github_repo,
          github_base_branch,
          github_remote_name,
          github_remote_url,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        validationRunId,
        input.taskId,
        taskValidationNumber,
        input.branch,
        input.commitSha,
        input.prTarget.owner,
        input.prTarget.repo,
        input.prTarget.baseBranch,
        input.prTarget.remoteName,
        input.prTarget.remoteUrl,
        input.now,
        input.now,
      );

    database
      .prepare("UPDATE tasks SET state = 'validating', updated_at = ? WHERE id = ?")
      .run(input.now, input.taskId);

    database.exec("COMMIT");

    return {
      ok: true,
      validationRunId,
      taskState: "validating",
      previousTaskState: readiness.previousTaskState,
    };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordToolingFailure = (
  database: DatabaseSync,
  input: RecordValidationToolingFailureInput,
): RecordValidationToolingFailureResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    if (!validationRunExists(database, input.validationRunId)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "VALIDATION_RUN_NOT_FOUND" };
    }

    recordValidationRunToolingErrorMutation(database, {
      validationRunId: input.validationRunId,
      ...validationToolingFailureRecord(input.toolingFailure),
      now: input.now,
    });
    database
      .prepare(
        "UPDATE tasks SET state = ?, updated_at = ? WHERE id = (SELECT task_id FROM validation_runs WHERE id = ?)",
      )
      .run(input.taskRecoveryState, input.now, input.validationRunId);

    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordCheckRound = (
  database: DatabaseSync,
  input: RecordValidationRunCheckRoundInput,
): RecordValidationCheckRoundResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    if (!validationRunExists(database, input.validationRunId)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "VALIDATION_RUN_NOT_FOUND" };
    }

    database
      .prepare(`
        INSERT INTO validation_run_rounds (
          validation_run_id,
          phase,
          round_number,
          status,
          created_at,
          updated_at
        )
        VALUES (?, 'checks', ?, ?, ?, ?)
      `)
      .run(input.validationRunId, input.roundNumber, input.roundStatus, input.now, input.now);

    database
      .prepare(`
        INSERT INTO validation_run_phase_statuses (
          validation_run_id,
          phase,
          status,
          error_message,
          created_at,
          updated_at
        )
        VALUES (?, 'checks', ?, NULL, ?, ?)
        ON CONFLICT(validation_run_id, phase) DO UPDATE SET
          status = excluded.status,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at
      `)
      .run(input.validationRunId, input.phaseStatus, input.now, input.now);

    for (const artifact of input.artifactRecords) {
      database
        .prepare(`
          INSERT INTO validation_run_artifacts (
            ref,
            validation_run_id,
            phase,
            producer,
            path,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
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
        .prepare(`
          INSERT INTO validation_run_findings (
            id,
            validation_run_id,
            phase,
            producer,
            title,
            description,
            severity,
            evidence,
            files,
            artifact_refs,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
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
      database
        .prepare("UPDATE validation_runs SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(input.now, input.validationRunId);
      database
        .prepare(
          "UPDATE tasks SET state = 'needs_input', updated_at = ? WHERE id = (SELECT task_id FROM validation_runs WHERE id = ?)",
        )
        .run(input.now, input.validationRunId);
    } else {
      database
        .prepare("UPDATE validation_runs SET updated_at = ? WHERE id = ?")
        .run(input.now, input.validationRunId);
    }

    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const nextTaskValidationNumber = (database: DatabaseSync, taskId: PublicTaskId): number => {
  const row = queryOne<TaskValidationNumberRow>(
    database,
    "SELECT COALESCE(MAX(task_validation_number), 0) + 1 AS taskValidationNumber FROM validation_runs WHERE task_id = ?",
    [taskId],
  );

  if (row === undefined) {
    throw new Error("Missing next task Validation Run number");
  }

  return Number(row.taskValidationNumber);
};

const getTaskForSubmit = (
  database: DatabaseSync,
  taskId: PublicTaskId,
): SubmitTaskRecord | undefined => {
  const row = queryOne<SubmitTaskRow>(
    database,
    "SELECT id, state, branch FROM tasks WHERE id = ?",
    [taskId],
  );

  if (row === undefined) {
    return undefined;
  }

  return {
    id: storedPublicTaskId(row.id),
    state: row.state,
    branch: row.branch,
  };
};

type SubmitTaskRecord = {
  readonly id: PublicTaskId;
  readonly state: TaskState;
  readonly branch: string | null;
};

type SubmitTaskRow = {
  readonly id: string;
  readonly state: TaskState;
  readonly branch: string | null;
};

type ValidationRunIdRow = {
  readonly id: string;
};

type TaskIdRow = {
  readonly id: string;
};

type TaskValidationNumberRow = {
  readonly taskValidationNumber: number | bigint;
};
