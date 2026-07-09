import type { DatabaseSync } from "node:sqlite";

import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryOne } from "./query.js";
import { encodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import {
  recordValidationRunToolingErrorMutation,
  validationRunExists,
} from "./sqliteValidationRunInternals.js";
import { submitStateReadiness, type SubmitEligibleState } from "../task/submitPolicy.js";
import { storedPublicTaskId, taskSlugForId, type PublicTaskId } from "../task/taskId.js";
import type { TaskState } from "../task/lifecycle.js";
import {
  TaskContextSnapshotFailed,
  validationToolingFailureRecord,
} from "../validation/validationToolingFailures.js";
import type {
  RecordValidationRunCheckRoundInput,
  RecordValidationRunCommandRoundInput,
  RecordValidationRunPhaseStatusInput,
  RecordValidationRunPrepareRoundInput,
} from "../validationRun/validationRunStore.js";
import { encodeSqliteTaskContextSnapshot } from "./sqliteTaskContextSnapshot.js";
import type {
  RecordValidationCommandRoundResult,
  RecordValidationPhaseStatusResult,
  RecordValidationToolingFailureInput,
  RecordValidationToolingFailureResult,
  RecoverPendingTaskContextSnapshotInput,
  RecoverPendingTaskContextSnapshotResult,
  SaveTaskContextSnapshotInput,
  SaveTaskContextSnapshotResult,
  StartValidationRunInput,
  StartValidationRunResult,
  ValidationRuns,
} from "../validation/validationRuns.js";

export const openSqliteValidationRuns = (input: SqliteStoreInput): ValidationRuns => ({
  start: (startInput) =>
    withStateDatabase(input, (database) => startValidationRun(database, startInput)),
  saveTaskContextSnapshot: (snapshotInput) =>
    withStateDatabase(input, (database) => saveTaskContextSnapshot(database, snapshotInput)),
  recoverPendingTaskContextSnapshot: (recoveryInput) =>
    withStateDatabase(input, (database) =>
      recoverPendingTaskContextSnapshot(database, recoveryInput),
    ),
  recordToolingFailure: (toolingErrorInput) =>
    withStateDatabase(input, (database) => recordToolingFailure(database, toolingErrorInput)),
  recordPhaseStatus: (phaseStatusInput) =>
    withStateDatabase(input, (database) => recordPhaseStatus(database, phaseStatusInput)),
  recordPrepareRound: (prepareRoundInput) =>
    withStateDatabase(input, (database) => recordPrepareRound(database, prepareRoundInput)),
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
          updated_at,
          previous_task_state,
          task_context_snapshot_state,
          task_context_snapshot
        )
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL)
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
        readiness.previousTaskState,
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

const saveTaskContextSnapshot = (
  database: DatabaseSync,
  input: SaveTaskContextSnapshotInput,
): SaveTaskContextSnapshotResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const row = queryOne<TaskContextSnapshotRow>(
      database,
      `SELECT task_context_snapshot_state AS state, task_context_snapshot AS snapshot
       FROM validation_runs WHERE id = ?`,
      [input.validationRunId],
    );

    if (row === undefined) {
      database.exec("ROLLBACK");
      return { ok: false, code: "VALIDATION_RUN_NOT_FOUND" };
    }

    const encoded = encodeSqliteTaskContextSnapshot(input.snapshot);

    if (row.state === "saved") {
      database.exec("ROLLBACK");
      return row.snapshot === encoded
        ? { ok: true }
        : { ok: false, code: "TASK_CONTEXT_SNAPSHOT_REPLACEMENT_REJECTED" };
    }

    if (row.state !== "pending" || row.snapshot !== null) {
      database.exec("ROLLBACK");
      return { ok: false, code: "TASK_CONTEXT_SNAPSHOT_NOT_PENDING" };
    }

    database
      .prepare(
        `UPDATE validation_runs
         SET task_context_snapshot_state = 'saved', task_context_snapshot = ?, updated_at = ?
         WHERE id = ? AND task_context_snapshot_state = 'pending' AND task_context_snapshot IS NULL`,
      )
      .run(encoded, input.now, input.validationRunId);
    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recoverPendingTaskContextSnapshot = (
  database: DatabaseSync,
  input: RecoverPendingTaskContextSnapshotInput,
): RecoverPendingTaskContextSnapshotResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    const pending = queryOne<PendingSnapshotRow>(
      database,
      `SELECT id, previous_task_state AS previousTaskState
       FROM validation_runs
       WHERE task_id = ? AND status = 'active' AND task_context_snapshot_state = 'pending'
       LIMIT 1`,
      [input.taskId],
    );

    if (pending === undefined) {
      database.exec("COMMIT");
      return { ok: true, recoveredValidationRunId: null };
    }

    if (pending.previousTaskState === null) {
      throw new Error("Pending Task Context Snapshot is missing its previous Task state");
    }

    const failure = new TaskContextSnapshotFailed({
      operationName: "recover_pending_task_context_snapshot",
      message: "Task Context Snapshot creation was interrupted before it was saved.",
    });
    recordValidationRunToolingErrorMutation(database, {
      validationRunId: pending.id,
      ...validationToolingFailureRecord(failure),
      now: input.now,
    });
    database
      .prepare(
        `UPDATE validation_runs
         SET task_context_snapshot_state = 'failed', status = 'error', updated_at = ?
         WHERE id = ?`,
      )
      .run(input.now, pending.id);
    database
      .prepare("UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?")
      .run(pending.previousTaskState, input.now, input.taskId);

    database.exec("COMMIT");
    return { ok: true, recoveredValidationRunId: pending.id };
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

    if (input.toolingFailure._tag === "TaskContextSnapshotFailed") {
      database
        .prepare(
          "UPDATE validation_runs SET task_context_snapshot_state = 'failed' WHERE id = ? AND task_context_snapshot_state = 'pending'",
        )
        .run(input.validationRunId);
    }

    const recovery = queryOne<PreviousTaskStateRow>(
      database,
      "SELECT previous_task_state AS previousTaskState FROM validation_runs WHERE id = ?",
      [input.validationRunId],
    );
    database
      .prepare(
        "UPDATE tasks SET state = ?, updated_at = ? WHERE id = (SELECT task_id FROM validation_runs WHERE id = ?)",
      )
      .run(
        recovery?.previousTaskState ?? input.taskRecoveryState,
        input.now,
        input.validationRunId,
      );

    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordPhaseStatus = (
  database: DatabaseSync,
  input: RecordValidationRunPhaseStatusInput,
): RecordValidationPhaseStatusResult => {
  database.exec("BEGIN IMMEDIATE");

  try {
    if (!validationRunExists(database, input.validationRunId)) {
      database.exec("ROLLBACK");
      return { ok: false, code: "VALIDATION_RUN_NOT_FOUND" };
    }

    recordPhaseStatusMutation(database, input);
    database
      .prepare("UPDATE validation_runs SET updated_at = ? WHERE id = ?")
      .run(input.now, input.validationRunId);

    database.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordPrepareRound = (
  database: DatabaseSync,
  input: RecordValidationRunPrepareRoundInput,
): RecordValidationCommandRoundResult =>
  recordCommandRound(database, { ...input, phase: "prepare", producer: "prepare" });

const recordCheckRound = (
  database: DatabaseSync,
  input: RecordValidationRunCheckRoundInput,
): RecordValidationCommandRoundResult =>
  recordCommandRound(database, { ...input, phase: "checks" });

const recordCommandRound = (
  database: DatabaseSync,
  input: RecordValidationRunCommandRoundInput,
): RecordValidationCommandRoundResult => {
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
          producer,
          round_number,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.validationRunId,
        input.phase,
        input.producer,
        input.roundNumber,
        input.roundStatus,
        input.now,
        input.now,
      );

    recordPhaseStatusMutation(database, {
      validationRunId: input.validationRunId,
      phase: input.phase,
      status: input.phaseStatus,
      now: input.now,
    });

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

const recordPhaseStatusMutation = (
  database: DatabaseSync,
  input: RecordValidationRunPhaseStatusInput,
): void => {
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
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(validation_run_id, phase) DO UPDATE SET
        status = excluded.status,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `)
    .run(
      input.validationRunId,
      input.phase,
      input.status,
      input.errorMessage ?? null,
      input.now,
      input.now,
    );
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

type TaskContextSnapshotRow = {
  readonly state: "not_required" | "pending" | "saved" | "failed";
  readonly snapshot: string | null;
};

type PreviousTaskStateRow = {
  readonly previousTaskState: SubmitEligibleState | null;
};

type PendingSnapshotRow = PreviousTaskStateRow & {
  readonly id: string;
};

type TaskIdRow = {
  readonly id: string;
};

type TaskValidationNumberRow = {
  readonly taskValidationNumber: number | bigint;
};
