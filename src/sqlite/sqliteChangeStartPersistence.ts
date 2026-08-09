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
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import {
  type DecodedTaskGraph,
  readDecodedTaskGraph,
  taskDependencyFacts,
} from "./sqliteTaskReadModel.js";

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
    const activeReview = yield* readActiveTaskReview(sql, taskId);
    if (activeReview !== undefined) {
      return {
        ok: false as const,
        code: "task_review_active" as const,
        reviewId: activeReview.reviewId,
      };
    }
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
    const graph = yield* readDecodedTaskGraph(sql, "prepare Task-backed Change Start");
    const task = graph.tasksById.get(taskId);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    const activeReview = yield* readActiveTaskReview(sql, taskId);
    if (activeReview !== undefined) {
      return {
        ok: false as const,
        code: "task_review_active" as const,
        reviewId: activeReview.reviewId,
      };
    }
    if (task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const blockedBy = taskDependencyFacts(graph, taskId, "prerequisites").filter(
      (dependency) => dependency.state !== "done",
    );
    return blockedBy.length === 0
      ? { ok: true as const, task }
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });

const readTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    readDecodedTaskGraph(sql, "prepare Task-backed Change Start"),
    (graph: DecodedTaskGraph) => graph.tasksById.get(taskId),
  );

const readActiveTaskReview = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<{ readonly reviewId: string }>`
      SELECT review_id AS reviewId FROM active_task_reviews WHERE task_id = ${taskId}
    `,
    (rows) => rows[0],
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
  if (
    row === undefined ||
    row.baseRef === null ||
    row.baseRemoteUrl === null ||
    row.startingCommit === null ||
    row.worktreePath === null
  ) {
    return Effect.succeed(undefined);
  }
  const baseRef = row.baseRef;
  const baseRemoteUrl = row.baseRemoteUrl;
  const startingCommit = row.startingCommit;
  const worktreePath = row.worktreePath;
  return Effect.try({
    try: (): ChangeStartRecord => ({
      id: row.id,
      repositoryCommonDirectory: row.repositoryCommonDirectory,
      branchRef: row.branchRef,
      baseRef,
      baseRemoteUrl,
      taskId: row.taskId === null ? null : storedPublicTaskId(row.taskId),
      startingCommit,
      worktreePath,
      acceptanceContext:
        row.acceptanceContext === null
          ? null
          : decodeSqliteAcceptanceContextSnapshot(row.acceptanceContext),
      prepare:
        row.prepareCommand === null || row.prepareTimeoutSeconds === null
          ? null
          : { command: row.prepareCommand, timeoutSeconds: row.prepareTimeoutSeconds },
      prepareFailure:
        row.prepareFailure === null ? null : decodeSqliteChangePrepareFailure(row.prepareFailure),
      publication: decodeSqliteChangePublication(row),
      cleanup: { state: row.cleanupState, blockingReason: row.cleanupBlockingReason },
      state: row.state,
      closeReason: row.closeReason,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      closedAt: row.closedAt,
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({ operationName: "read Change Start", cause }),
  });
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type ChangeStartRow = {
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly baseRemoteUrl: string | null;
  readonly taskId: string | null;
  readonly startingCommit: string | null;
  readonly worktreePath: string | null;
  readonly acceptanceContext: string | null;
  readonly prepareCommand: string | null;
  readonly prepareTimeoutSeconds: number | null;
  readonly prepareFailure: string | null;
  readonly cleanupState: ChangeStartRecord["cleanup"]["state"];
  readonly cleanupBlockingReason: string | null;
  readonly state: ChangeStartRecord["state"];
  readonly closeReason: ChangeStartRecord["closeReason"];
  readonly cancelReason: ChangeStartRecord["cancelReason"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
} & SqliteChangePublicationRow;
