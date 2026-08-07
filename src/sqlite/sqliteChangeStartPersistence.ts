import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangePrepareFailure } from "../change/change.js";
import type { ChangeStartPersistence } from "../change/changeStartPersistence.js";
import type { ChangeStartRecord, CreateChangeStartInput } from "../change/changeStartStore.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskDependencyFact } from "../task/task.js";
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
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import {
  decodeChangeCleanup,
  decodeChangeCloseReason,
  decodeChangeLifecycleConsistency,
  decodeChangePrepare,
  decodeChangeState,
  decodeTaskState,
  requiredPositiveInteger,
  requiredString,
} from "./sqlitePersistenceDecoders.js";

const columns = [
  "id",
  "repository_common_directory AS repositoryCommonDirectory",
  "branch_ref AS branchRef",
  "base_ref AS baseRef",
  "base_remote_url AS baseRemoteUrl",
  "task_id AS taskId",
  "starting_commit AS startingCommit",
  "worktree_path AS worktreePath",
  "acceptance_context AS acceptanceContext",
  "prepare_command AS prepareCommand",
  "prepare_timeout_seconds AS prepareTimeoutSeconds",
  "prepare_failure AS prepareFailure",
  "publication_candidate_id AS publicationCandidateId",
  "publication_validation_run_id AS publicationValidationRunId",
  "publication_owner AS publicationOwner",
  "publication_repo AS publicationRepo",
  "publication_base_branch AS publicationBaseBranch",
  "publication_remote_name AS publicationRemoteName",
  "publication_head_branch AS publicationHeadBranch",
  "publication_expected_head_sha AS publicationExpectedHeadSha",
  "publication_pr_number AS publicationPrNumber",
  "publication_pr_url AS publicationPrUrl",
  "cleanup_state AS cleanupState",
  "cleanup_blocking_reason AS cleanupBlockingReason",
  "state",
  "close_reason AS closeReason",
  "cancel_reason AS cancelReason",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
  "closed_at AS closedAt",
].join(", ");

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
    const task = yield* readTask(sql, taskId);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const blockedByRows = yield* sql<{
      readonly id: unknown;
      readonly title: unknown;
      readonly state: unknown;
      readonly numericId: unknown;
    }>`
      SELECT tasks.id, tasks.title, tasks.state, tasks.numeric_id AS numericId
      FROM task_dependencies
      JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskId} AND tasks.state <> 'done'
    `;
    const blockedBy = yield* Effect.try({
      try: () =>
        blockedByRows
          .map((row) => ({
            fact: {
              id: storedPublicTaskId(requiredString(row.id, "Change Start dependency Task ID")),
              title: requiredString(row.title, "Change Start dependency Task title"),
              state: decodeTaskState(row.state),
            } satisfies TaskDependencyFact,
            numericId: requiredPositiveInteger(
              row.numericId,
              "Change Start dependency Task numeric ID",
            ),
          }))
          .sort((left, right) => left.numericId - right.numericId)
          .map(({ fact }) => fact),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "read Change Start Task eligibility",
          cause,
        }),
    });
    return blockedBy.length === 0
      ? { ok: true as const, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const readTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.flatMap(
    sql<TaskRow>`SELECT id, title, description, state FROM tasks WHERE id = ${taskId}`,
    (rows) => {
      const row = rows[0];
      return row === undefined
        ? Effect.succeed(undefined)
        : Effect.try({
            try: () => ({
              id: storedPublicTaskId(requiredString(row.id, "Change Start Task ID")),
              title: requiredString(row.title, "Change Start Task title"),
              description: requiredString(row.description, "Change Start Task description"),
              state: decodeTaskState(row.state),
            }),
            catch: (cause) =>
              new RepositoryPersistedDataInvalid({
                operationName: "read Change Start Task",
                cause,
              }),
          });
    },
  );

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

const getByTaskId = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.flatMap(
    sql.unsafe<ChangeStartRow>(`SELECT ${columns} FROM changes WHERE task_id = ?`, [taskId]),
    (rows) => mapRow(rows[0]),
  );

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeStartRow>(`SELECT ${columns} FROM changes WHERE id = ?`, [changeId]),
    (rows) => mapRow(rows[0]),
  );

const mapRow = (row: ChangeStartRow | undefined) => {
  if (row === undefined) return Effect.succeed(undefined);
  return Effect.try({
    try: (): ChangeStartRecord => {
      const state = decodeChangeState(row.state);
      const closeReason = decodeChangeCloseReason(row.closeReason);
      const closedAt = decodeChangeLifecycleConsistency(state, closeReason, row.closedAt);
      const prepare = decodeChangePrepare(row.prepareCommand, row.prepareTimeoutSeconds);
      return {
        id: requiredString(row.id, "Change Start ID"),
        repositoryCommonDirectory: requiredString(
          row.repositoryCommonDirectory,
          "Change Start repository common directory",
        ),
        branchRef: requiredString(row.branchRef, "Change Start branch ref"),
        baseRef: requiredString(row.baseRef, "Change Start base ref"),
        baseRemoteUrl: requiredString(row.baseRemoteUrl, "Change Start base remote URL"),
        taskId:
          row.taskId === null
            ? null
            : storedPublicTaskId(requiredString(row.taskId, "Change Start Task ID")),
        startingCommit: requiredString(row.startingCommit, "Change Start starting commit"),
        worktreePath: requiredString(row.worktreePath, "Change Start worktree path"),
        acceptanceContext:
          row.acceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(
                requiredString(row.acceptanceContext, "Change Start Acceptance Context"),
              ),
        prepare,
        prepareFailure:
          row.prepareFailure === null
            ? null
            : decodeSqliteChangePrepareFailure(
                requiredString(row.prepareFailure, "Change preparation failure"),
              ),
        publication: decodeSqliteChangePublication(row),
        cleanup: decodeChangeCleanup(row.cleanupState, row.cleanupBlockingReason),
        state,
        closeReason,
        cancelReason:
          row.cancelReason === null
            ? null
            : requiredString(row.cancelReason, "Change cancel reason"),
        createdAt: requiredString(row.createdAt, "Change creation timestamp"),
        updatedAt: requiredString(row.updatedAt, "Change update timestamp"),
        closedAt,
      };
    },
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({ operationName: "read Change Start", cause }),
  });
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type TaskRow = {
  readonly id: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly state: unknown;
};

type ChangeStartRow = {
  readonly id: unknown;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly baseRemoteUrl: unknown;
  readonly taskId: unknown;
  readonly startingCommit: unknown;
  readonly worktreePath: unknown;
  readonly acceptanceContext: unknown;
  readonly prepareCommand: unknown;
  readonly prepareTimeoutSeconds: unknown;
  readonly prepareFailure: unknown;
  readonly cleanupState: unknown;
  readonly cleanupBlockingReason: unknown;
  readonly state: unknown;
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly closedAt: unknown;
} & SqliteChangePublicationRow;
