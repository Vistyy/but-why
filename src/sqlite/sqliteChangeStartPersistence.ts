import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangePrepareFailure } from "../change/change.js";
import type { ChangeStartPersistence } from "../change/changeStartPersistence.js";
import type { ChangeStartRecord, CreateChangeStartInput } from "../change/changeStartStore.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "./sqliteAcceptanceContextSnapshot.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "./sqliteChangePreparation.js";
import { decodeChangeState, decodeNullablePositiveInteger } from "./sqliteChangeReadModel.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredString,
  decodeStoredTaskState,
  decodeTaskContextRow,
  decodeTaskDependencyFacts,
  type UnknownTaskContextRow,
  type UnknownTaskDependencyFactRow,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangeStartPersistence = (): Effect.Effect<
  ChangeStartPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    prepareTask: (taskId) =>
      repository.transaction("prepare Task-backed Change Start", (sql) => prepareTask(sql, taskId)),
    create: (input) =>
      repository.transactionImmediate("create Change Start", (sql) => create(sql, input)),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) => getById(sql, changeId)),
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        recordPrepareOutcome(sql, changeId, failure, now),
      ),
  }));

const prepareTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const existing = yield* getByTaskId(sql, taskId);
    if (existing !== undefined) {
      const task = yield* readTask(sql, taskId);
      if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
      return task.state === "todo"
        ? { ok: true as const, existing }
        : { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const eligibility = yield* readEligibility(sql, taskId);
    return eligibility.ok ? { ok: true as const, existing: undefined } : eligibility;
  });

const create = (sql: SqlClient.SqlClient, input: CreateChangeStartInput) =>
  Effect.gen(function* () {
    const conflicts = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes
      WHERE id = ${input.id}
        OR (repository_common_directory = ${input.repositoryCommonDirectory} AND branch_ref = ${input.branchRef})
        OR worktree_path = ${input.worktreePath}
      LIMIT 1
    `;
    if (conflicts.length > 0) {
      return { ok: false as const, code: "change_start_conflict" as const };
    }

    let acceptanceContext: AcceptanceContextSnapshotV1 | null = null;
    if (input.taskId !== undefined) {
      const eligibility = yield* readEligibility(sql, input.taskId);
      if (!eligibility.ok) return eligibility;
      if ((yield* getByTaskId(sql, input.taskId)) !== undefined) {
        return { ok: false as const, code: "change_start_conflict" as const };
      }
      acceptanceContext = {
        version: 1,
        title: eligibility.task.title,
        description: eligibility.task.description,
      };
    }

    yield* sql`
      INSERT INTO changes (
        id, repository_common_directory, branch_ref, base_ref, base_remote_url, task_id,
        starting_commit, worktree_path, acceptance_context,
        prepare_command, prepare_timeout_seconds, prepare_failure,
        state, close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${input.id}, ${input.repositoryCommonDirectory}, ${input.branchRef}, ${input.baseRef},
        ${input.baseRemoteUrl}, ${input.taskId ?? null}, ${input.startingCommit}, ${input.worktreePath},
        ${acceptanceContext === null ? null : encodeSqliteAcceptanceContextSnapshot(acceptanceContext)},
        ${input.prepare?.command ?? null}, ${input.prepare?.timeoutSeconds ?? null},
        NULL, 'open', NULL, ${input.now}, ${input.now}, NULL
      )
    `;
    const change = yield* getById(sql, input.id);
    if (change === undefined)
      return yield* invalidData("create Change Start", "Change disappeared");
    return { ok: true as const, change };
  });

const readEligibility = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<UnknownEligibilityTaskRow>`
      SELECT id, title, description, state FROM tasks WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return { ok: false as const, code: "task_not_found" as const };
    const task = yield* decodePersisted("prepare Task-backed Change Start", () => ({
      ...decodeTaskContextRow(row),
      state: decodeStoredTaskState(row.state),
    }));
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const dependencyRows = yield* sql<UnknownTaskDependencyFactRow>`
      SELECT tasks.id, CAST(tasks.numeric_id AS TEXT) AS numericId,
        typeof(tasks.numeric_id) AS numericIdType, tasks.title, tasks.state
      FROM task_dependencies
      LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskId}
      ORDER BY tasks.numeric_id ASC
    `;
    const blockedBy = (yield* decodePersisted("prepare Task-backed Change Start", () =>
      decodeTaskDependencyFacts(dependencyRows, taskId),
    )).filter((dependency) => dependency.state !== "done");
    return blockedBy.length === 0
      ? { ok: true as const, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const readTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly state: unknown }>`
      SELECT state FROM tasks WHERE id = ${taskId}
    `;
    return rows[0] === undefined
      ? undefined
      : {
          state: yield* decodePersisted("prepare Task-backed Change Start", () =>
            decodeStoredTaskState(rows[0]?.state),
          ),
        };
  });

const recordPrepareOutcome = (
  sql: SqlClient.SqlClient,
  changeId: string,
  failure: ChangePrepareFailure | null,
  now: string,
) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE changes SET prepare_failure = ${failure === null ? null : encodeSqliteChangePrepareFailure(failure)}, updated_at = ${now}
      WHERE id = ${changeId}
    `;
    const change = yield* getById(sql, changeId);
    return change === undefined
      ? yield* invalidData("record Change preparation outcome", "Change was not found")
      : change;
  });

const changeStartSelectionColumns = `
  id, repository_common_directory AS repositoryCommonDirectory,
  branch_ref AS branchRef, base_ref AS baseRef, base_remote_url AS baseRemoteUrl,
  task_id AS taskId, starting_commit AS startingCommit, worktree_path AS worktreePath,
  acceptance_context AS acceptanceContext, prepare_command AS prepareCommand,
  CAST(prepare_timeout_seconds AS TEXT) AS prepareTimeoutSeconds,
  typeof(prepare_timeout_seconds) AS prepareTimeoutSecondsType,
  prepare_failure AS prepareFailure, state
`;

type UnknownChangeStartRow = Record<string, unknown>;

const getByTaskId = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeStartRow>(
      `SELECT ${changeStartSelectionColumns} FROM changes WHERE task_id = ?`,
      [taskId],
    ),
    (rows) => mapRow(rows[0]),
  );

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeStartRow>(
      `SELECT ${changeStartSelectionColumns} FROM changes WHERE id = ?`,
      [changeId],
    ),
    (rows) => mapRow(rows[0]),
  );

const mapRow = (row: UnknownChangeStartRow | undefined) =>
  row === undefined
    ? Effect.succeed(undefined)
    : decodePersisted("read Change Start", () => decodeChangeStart(row));

const decodeChangeStart = (row: UnknownChangeStartRow): ChangeStartRecord => {
  const storedTaskId = decodeStoredNullableString(row["taskId"], "Change Task ID");
  const encodedAcceptanceContext = decodeStoredNullableString(
    row["acceptanceContext"],
    "Change Acceptance Context",
  );
  if ((storedTaskId === null) !== (encodedAcceptanceContext === null)) {
    throw new Error("Stored Change Task and Acceptance Context relationship is incomplete");
  }
  const prepareCommand = decodeStoredNullableString(
    row["prepareCommand"],
    "Change prepare command",
  );
  const prepareTimeoutSeconds = decodeNullablePositiveInteger(
    row["prepareTimeoutSeconds"],
    row["prepareTimeoutSecondsType"],
    "Change prepare timeout",
  );
  if ((prepareCommand === null) !== (prepareTimeoutSeconds === null)) {
    throw new Error("Stored Change preparation relationship is incomplete");
  }
  const encodedPrepareFailure = decodeStoredNullableString(
    row["prepareFailure"],
    "Change preparation failure",
  );
  if (encodedPrepareFailure !== null && prepareCommand === null) {
    throw new Error("Stored Change preparation failure has no preparation definition");
  }
  return {
    id: decodeStoredString(row["id"], "Change ID"),
    repositoryCommonDirectory: decodeStoredString(
      row["repositoryCommonDirectory"],
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row["branchRef"], "Change Repository Branch"),
    baseRef: decodeStoredString(row["baseRef"], "Change Base ref"),
    baseRemoteUrl: decodeStoredString(row["baseRemoteUrl"], "Change Base remote URL"),
    taskId: storedTaskId === null ? null : storedPublicTaskId(storedTaskId),
    startingCommit: decodeStoredString(row["startingCommit"], "Change starting commit"),
    worktreePath: decodeStoredString(row["worktreePath"], "Change Managed Worktree path"),
    acceptanceContext:
      encodedAcceptanceContext === null
        ? null
        : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
    prepare:
      prepareCommand === null || prepareTimeoutSeconds === null
        ? null
        : { command: prepareCommand, timeoutSeconds: prepareTimeoutSeconds },
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    state: decodeChangeState(row["state"]),
  };
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type UnknownEligibilityTaskRow = UnknownTaskContextRow & {
  readonly state: unknown;
};
