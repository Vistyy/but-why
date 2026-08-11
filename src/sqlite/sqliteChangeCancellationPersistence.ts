import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangeCleanup, type ChangePublication, changeState } from "../change/change.js";
import type {
  CancellationChange,
  ChangeCancellationPort,
  ReconciliationChange,
} from "../change/changePorts.js";
import type { CancelChangeInput, CompleteMergedChangeInput } from "../change/changeStore.js";
import type { ObservedMergedChangeEvidence } from "../change/ownedPullRequestClassifier.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskDependencyFact } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeChangePublication,
  decodeChangeState,
  decodeCloseReason,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import {
  type DecodedStoredTaskRecordRow,
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredString,
  decodeStoredTaskId,
  decodeStoredTaskRecordRow,
  decodeTaskDependencyFacts,
  type UnknownStoredTaskRecordRow,
  type UnknownTaskDependencyFactRow,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangeCancellationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeCancellationPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for cancellation", (sql) =>
          readCancellationChange(sql, changeId, "read Change for cancellation"),
        ),
      getChangeByTaskId: (taskId) =>
        repository.transaction("read Change by Task for cancellation", (sql) =>
          readCancellationChangeByTaskId(sql, taskId),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeMergedChange(sql, input);
            if (!result.ok) return result;
            const change = yield* requireCancellationChange(sql, input.changeId);
            const task = yield* readRequiredCancellationTask(sql, change);
            return { ...result, change, task };
          }),
        ),
      cancelChange: (input) =>
        repository.transactionImmediate("cancel Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* cancelChange(sql, input);
            if (!result.ok) return result;
            const change = yield* requireCancellationChange(sql, input.changeId);
            const task = yield* readRequiredCancellationTask(sql, change);
            return { ...result, change, task };
          }),
        ),
    }),
  );
const publicationSelectionColumns = `
  id, state,
  publication_candidate_id AS publicationCandidateId,
  publication_validation_run_id AS publicationValidationRunId,
  publication_owner AS publicationOwner, publication_repo AS publicationRepo,
  publication_base_branch AS publicationBaseBranch,
  publication_remote_name AS publicationRemoteName,
  publication_head_branch AS publicationHeadBranch,
  publication_expected_head_sha AS publicationExpectedHeadSha,
  CAST(publication_pr_number AS TEXT) AS publicationPrNumber,
  typeof(publication_pr_number) AS publicationPrNumberType,
  publication_pr_url AS publicationPrUrl
`;
const terminalChangeSelectionColumns = `
  ${publicationSelectionColumns},
  repository_common_directory AS repositoryCommonDirectory,
  branch_ref AS branchRef,
  base_remote_url AS baseRemoteUrl,
  worktree_path AS worktreePath,
  cleanup_state AS cleanupState,
  cleanup_blocking_reason AS cleanupBlockingReason
`;
const decodeTerminalChange = (
  row: Record<string, unknown>,
  changeId: string,
): ReconciliationChange => {
  const publication = decodeChangePublication(row);
  const base = {
    ...decodeSelectedChangeState(row, changeId),
    repositoryCommonDirectory: decodeStoredString(
      row["repositoryCommonDirectory"],
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row["branchRef"], "Change branch reference"),
    worktreePath: decodeStoredNullableString(row["worktreePath"], "Change Managed Worktree path"),
    cleanup: decodeSelectedCleanup(row),
  };
  if (publication === null) return { ...base, publication, remoteChangeBranch: null };
  if (publication.pullRequest === null) {
    return {
      ...base,
      publication: { ...publication, pullRequest: null },
      remoteChangeBranch: null,
    };
  }
  const ownedPublication = { ...publication, pullRequest: publication.pullRequest };
  const baseRemoteUrl = decodeStoredNullableString(row["baseRemoteUrl"], "Change Base remote URL");
  return {
    ...base,
    publication: ownedPublication,
    remoteChangeBranch: remoteChangeBranchForPublication(ownedPublication, baseRemoteUrl),
  };
};
const remoteChangeBranchForPublication = (
  publication: ChangePublication & {
    readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
  },
  baseRemoteUrl: string | null,
) => {
  if (baseRemoteUrl === null) throw new Error("Published Change lacks its Base remote URL");
  return {
    owner: publication.target.owner,
    repo: publication.target.repo,
    remoteName: publication.target.remoteName,
    remoteUrl: baseRemoteUrl,
    branchName: publication.headBranch,
    targetBranch: publication.target.baseBranch,
    expectedHeadSha: publication.expectedHeadSha,
  };
};
const decodeSelectedCleanup = (row: Record<string, unknown>): ChangeCleanup => {
  const state = decodeStoredString(row["cleanupState"], "Change cleanup state");
  if (state !== "complete" && state !== "pending") {
    throw new Error("Stored Change cleanup state is unsupported");
  }
  const blockingReason = decodeStoredNullableString(
    row["cleanupBlockingReason"],
    "Change cleanup blocking reason",
  );
  if (state === "complete" && blockingReason !== null) {
    throw new Error("Stored completed Change cleanup has a blocking reason");
  }
  return { state, blockingReason };
};
const decodeCancellationChange = (
  row: Record<string, unknown>,
  changeId: string,
): CancellationChange => {
  const terminal = decodeTerminalChange(row, changeId);
  const storedTaskId = decodeStoredNullableString(row["taskId"], "Change Task ID");
  return {
    ...terminal,
    taskId: storedTaskId === null ? null : decodeStoredTaskId(storedTaskId, "Change Task ID"),
    closeReason: decodeCloseReason(row["closeReason"]),
    cancelReason: decodeStoredNullableString(row["cancelReason"], "Change cancellation reason"),
  };
};
const readCancellationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<Record<string, unknown>>(
      `SELECT ${terminalChangeSelectionColumns}, task_id AS taskId,
        close_reason AS closeReason, cancel_reason AS cancelReason
       FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () =>
      decodeCancellationChange(row, changeId),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });
const requireCancellationChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(readCancellationChange(sql, changeId, "read committed cancellation"), (change) =>
    change === undefined
      ? invalidData("read committed cancellation", "Change disappeared")
      : Effect.succeed(change),
  );
const readRequiredCancellationTask = (sql: SqlClient.SqlClient, change: CancellationChange) =>
  change.taskId === null
    ? Effect.succeed(null)
    : Effect.flatMap(readCancellationTask(sql, change.taskId), (task) =>
        task === undefined
          ? invalidData("read committed cancellation", "Linked Task was not found")
          : Effect.succeed(task),
      );
const readCancellationTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const operationName = "read committed cancellation";
    const rows = yield* sql<UnknownStoredTaskRecordRow>`
      SELECT id, CAST(numeric_id AS TEXT) AS numericId,
        typeof(numeric_id) AS numericIdType, title, description, state,
        cancel_reason AS cancelReason, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
      WHERE id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const decoded = yield* decodePersisted(operationName, () => decodeStoredTaskRecordRow(row));
    const prerequisites = yield* cancellationTaskDependencyFacts(
      sql,
      taskId,
      "prerequisites",
      operationName,
    );
    const dependents = yield* cancellationTaskDependencyFacts(
      sql,
      taskId,
      "dependents",
      operationName,
    );
    return cancellationTaskRecord(decoded, prerequisites, dependents);
  });
const cancellationTaskDependencyFacts = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
  direction: "prerequisites" | "dependents",
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows =
      direction === "prerequisites"
        ? yield* sql<UnknownTaskDependencyFactRow>`
            SELECT tasks.id, CAST(tasks.numeric_id AS TEXT) AS numericId,
              typeof(tasks.numeric_id) AS numericIdType, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
            WHERE task_dependencies.dependent_task_id = ${taskId}
            ORDER BY tasks.numeric_id ASC
          `
        : yield* sql<UnknownTaskDependencyFactRow>`
            SELECT tasks.id, CAST(tasks.numeric_id AS TEXT) AS numericId,
              typeof(tasks.numeric_id) AS numericIdType, tasks.title, tasks.state
            FROM task_dependencies
            LEFT JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
            WHERE task_dependencies.prerequisite_task_id = ${taskId}
            ORDER BY tasks.numeric_id ASC
          `;
    return yield* decodePersisted(operationName, () => decodeTaskDependencyFacts(rows, taskId));
  });
const cancellationTaskRecord = (
  row: DecodedStoredTaskRecordRow,
  prerequisites: readonly TaskDependencyFact[],
  dependents: readonly TaskDependencyFact[],
) => {
  const { numericId: _numericId, ...summary } = row;
  const blockedBy = prerequisites.filter((dependency) => dependency.state !== "done");
  return {
    ...summary,
    startable: row.state === "todo" && blockedBy.length === 0,
    blockedBy,
    description: row.description,
    cancelReason: row.cancelReason,
    prerequisites,
    dependents,
  };
};
const readCancellationChangeByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const operationName = "read Change by Task for cancellation";
    const rows = yield* sql.unsafe<Record<string, unknown>>(
      `SELECT ${terminalChangeSelectionColumns}, task_id AS taskId,
        close_reason AS closeReason, cancel_reason AS cancelReason
       FROM changes WHERE task_id = ?`,
      [taskId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const changeId = decodeStoredString(row["id"], "Change ID");
    const selected = yield* decodePersisted(operationName, () =>
      decodeCancellationChange(row, changeId),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });
const readChangeLifecycle = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT id, state, close_reason AS closeReason, closed_at AS closedAt
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted(operationName, () => decodeSelectedChangeLifecycle(row, changeId));
  });
const readCompleteChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "complete merged Change";
    const rows = yield* sql.unsafe<Record<string, unknown>>(
      `SELECT ${publicationSelectionColumns}, close_reason AS closeReason,
        closed_at AS closedAt, task_id AS taskId
       FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => ({
      ...decodeSelectedChangeLifecycle(row, changeId),
      taskId: decodeStoredNullableString(row["taskId"], "Change Task ID"),
      publication: decodeChangePublication(row),
    }));
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });
const readCancelChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "cancel Change";
    const rows = yield* sql<Record<string, unknown>>`
      SELECT id, state, close_reason AS closeReason, closed_at AS closedAt,
        task_id AS taskId
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => ({
      ...decodeSelectedChangeLifecycle(row, changeId),
      taskId: decodeStoredNullableString(row["taskId"], "Change Task ID"),
    }));
  });
const decodeSelectedChangeState = (row: Record<string, unknown>, changeId: string) => {
  const id = decodeStoredString(row["id"], "Change ID");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row["state"]) };
};
const decodeSelectedChangeLifecycle = (row: Record<string, unknown>, changeId: string) => {
  const selected = decodeSelectedChangeState(row, changeId);
  const closeReason = decodeCloseReason(row["closeReason"]);
  const closedAt = decodeStoredNullableString(row["closedAt"], "Change closure time");
  if (
    (selected.state === changeState.open && (closeReason !== null || closedAt !== null)) ||
    (selected.state === changeState.closed && (closeReason === null || closedAt === null))
  ) {
    throw new Error("Stored Change lifecycle relationship is inconsistent");
  }
  return { ...selected, closeReason };
};
const completeMergedChange = (sql: SqlClient.SqlClient, input: CompleteMergedChangeInput) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, "complete merged Change");
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "completed") {
        return { ok: false as const, code: "change_already_closed" as const };
      }
      return { ok: true as const, changed: false };
    }
    const change = yield* readCompleteChange(sql, input.changeId);
    if (change === undefined)
      return yield* invalidData("complete merged Change", "Change disappeared");
    if (!matchesExactMergedEvidence(change, input.observed)) {
      return { ok: false as const, code: "publication_mismatch" as const };
    }
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'completed', cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'done', updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return { ok: true as const, changed: true };
  });
const matchesExactMergedEvidence = (
  change: { readonly publication: ChangePublication | null },
  observed: ObservedMergedChangeEvidence,
): boolean => {
  const publication = change.publication;
  return (
    publication !== null &&
    publication.pullRequest !== null &&
    publication.pullRequest.number === observed.pullRequest.number &&
    publication.target.owner === observed.repository.owner &&
    publication.target.repo === observed.repository.repo &&
    publication.target.baseBranch === observed.baseBranch &&
    publication.headBranch === observed.headBranch &&
    publication.candidateId === observed.candidateId &&
    publication.validationRunId === observed.validationRunId &&
    publication.expectedHeadSha === observed.expectedHeadSha &&
    publication.expectedHeadSha === observed.mergedHeadSha
  );
};
const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, "cancel Change");
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "cancelled") {
        return { ok: false as const, code: "change_already_completed" as const };
      }
      return { ok: true as const, changed: false };
    }
    const change = yield* readCancelChange(sql, input.changeId);
    if (change === undefined) return yield* invalidData("cancel Change", "Change disappeared");
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'cancelled', cancel_reason = ${change.taskId === null ? input.reason : null}, cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'cancelled', cancel_reason = ${input.reason}, updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return { ok: true as const, changed: true };
  });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
