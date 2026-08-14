import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangePrepareFailure } from "../change/change.js";
import type { ChangeStartPersistence } from "../change/changeStartPersistence.js";
import type {
  ChangeReviewerConfiguration,
  ChangeStartRecord,
  CreateChangeStartInput,
} from "../change/changeStartStore.js";
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
import {
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredPositiveInteger,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import {
  decodePersisted,
  decodeTaskContextRow,
  decodeTaskDependencyFacts,
  decodeTaskState,
  type StoredTaskContextRow,
  type StoredTaskDependencyFactRow,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangeStartPersistence = (): Effect.Effect<
  ChangeStartPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    prepareTask: (taskId) =>
      repository.transaction("prepare Change Start linked to a Task", (sql) =>
        prepareTask(sql, taskId),
      ),
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
        starting_commit, worktree_path, acceptance_context, reviewer_configuration,
        prepare_command, prepare_timeout_seconds, prepare_failure,
        state, close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${input.id}, ${input.repositoryCommonDirectory}, ${input.branchRef}, ${input.baseRef},
        ${input.baseRemoteUrl}, ${input.taskId ?? null}, ${input.startingCommit}, ${input.worktreePath},
        ${acceptanceContext === null ? null : encodeSqliteAcceptanceContextSnapshot(acceptanceContext)},
        ${JSON.stringify(input.reviewerConfiguration)},
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
    const rows = yield* sql<StoredEligibilityTaskRow>`
      SELECT id, title, description, state FROM tasks WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return { ok: false as const, code: "task_not_found" as const };
    const task = yield* decodePersisted("prepare Change Start linked to a Task", () => ({
      ...decodeTaskContextRow(row),
      state: decodeTaskState(row.state),
    }));
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const dependencyRows = yield* sql<StoredTaskDependencyFactRow>`
      SELECT tasks.id, tasks.numeric_id AS numericId, tasks.title, tasks.state
      FROM task_dependencies
      LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskId}
      ORDER BY tasks.numeric_id ASC
    `;
    const blockedBy = (yield* decodePersisted("prepare Change Start linked to a Task", () =>
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
      : yield* decodePersisted("prepare Change Start linked to a Task", () => ({
          state: decodeTaskState(rows[0]?.state),
        }));
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
  acceptance_context AS acceptanceContext, reviewer_configuration AS reviewerConfiguration,
  prepare_command AS prepareCommand,
  prepare_timeout_seconds AS prepareTimeoutSeconds,
  prepare_failure AS prepareFailure, state
`;

type StoredChangeStartRow = {
  readonly id: unknown;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly baseRemoteUrl: unknown;
  readonly taskId: unknown;
  readonly startingCommit: unknown;
  readonly worktreePath: unknown;
  readonly acceptanceContext: unknown;
  readonly reviewerConfiguration: unknown;
  readonly prepareCommand: unknown;
  readonly prepareTimeoutSeconds: unknown;
  readonly prepareFailure: unknown;
  readonly state: unknown;
};

const getByTaskId = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeStartRow>(
      `SELECT ${changeStartSelectionColumns} FROM changes WHERE task_id = ?`,
      [taskId],
    ),
    (rows) => mapRow(rows[0]),
  );

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeStartRow>(
      `SELECT ${changeStartSelectionColumns} FROM changes WHERE id = ?`,
      [changeId],
    ),
    (rows) => mapRow(rows[0]),
  );

const mapRow = (row: StoredChangeStartRow | undefined) =>
  row === undefined
    ? Effect.succeed(undefined)
    : decodePersisted("read Change Start", () => decodeChangeStart(row));

const decodeChangeStart = (row: StoredChangeStartRow): ChangeStartRecord => {
  const baseRef = decodeStoredNullableString(row.baseRef, "Change Base ref");
  const baseRemoteUrl = decodeStoredNullableString(row.baseRemoteUrl, "Change Base remote URL");
  const startingCommit = decodeStoredNullableString(row.startingCommit, "Change starting commit");
  const worktreePath = decodeStoredNullableString(row.worktreePath, "Change worktree path");
  if (
    baseRef === null ||
    baseRemoteUrl === null ||
    startingCommit === null ||
    worktreePath === null
  ) {
    throw new Error("Stored Change Start relationship is incomplete");
  }
  const taskId = decodeStoredNullableString(row.taskId, "Change Task id");
  const encodedAcceptanceContext = decodeStoredNullableString(
    row.acceptanceContext,
    "Change Acceptance Context",
  );
  if ((taskId === null) !== (encodedAcceptanceContext === null)) {
    throw new Error("Stored Change Task relationship is incomplete");
  }
  const prepareCommand = decodeStoredNullableString(row.prepareCommand, "Change prepare command");
  const prepareTimeoutSeconds =
    row.prepareTimeoutSeconds === null
      ? null
      : decodeStoredPositiveInteger(row.prepareTimeoutSeconds, "Change prepare timeout");
  if ((prepareCommand === null) !== (prepareTimeoutSeconds === null)) {
    throw new Error("Stored Change preparation relationship is incomplete");
  }
  const encodedReviewerConfiguration = decodeStoredNullableString(
    row.reviewerConfiguration,
    "Change Reviewer Configuration",
  );
  const reviewerConfiguration =
    encodedReviewerConfiguration === null
      ? null
      : decodeReviewerConfiguration(encodedReviewerConfiguration);
  const encodedPrepareFailure = decodeStoredNullableString(
    row.prepareFailure,
    "Change prepare failure",
  );
  if (encodedPrepareFailure !== null && prepareCommand === null) {
    throw new Error("Stored Change preparation failure relationship is incomplete");
  }
  return {
    id: decodeStoredString(row.id, "Change id"),
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
    baseRef,
    baseRemoteUrl,
    taskId: taskId === null ? null : storedPublicTaskId(taskId),
    startingCommit,
    worktreePath,
    acceptanceContext:
      encodedAcceptanceContext === null
        ? null
        : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
    reviewerConfiguration,
    prepare:
      prepareCommand === null || prepareTimeoutSeconds === null
        ? null
        : { command: prepareCommand, timeoutSeconds: prepareTimeoutSeconds },
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    state: decodeChangeState(row.state),
  };
};

const decodeReviewerConfiguration = (source: string): ChangeReviewerConfiguration => {
  const value: unknown = JSON.parse(source) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { specialistReviews?: unknown }).specialistReviews)
  ) {
    throw new Error("Stored Change Reviewer Configuration is invalid");
  }
  const configuration = value as ChangeReviewerConfiguration;
  if (
    configuration.acceptanceReview !== null &&
    typeof configuration.acceptanceReview !== "object"
  ) {
    throw new Error("Stored Change Acceptance Reviewer Configuration is invalid");
  }
  return configuration;
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type StoredEligibilityTaskRow = StoredTaskContextRow & {
  readonly state: unknown;
};
