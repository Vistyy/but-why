import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import {
  changeState,
  type ChangeCleanup,
  type ChangePublication,
  type ChangeRecord,
} from "../change/change.js";
import type { ChangePersistence } from "../change/changePersistence.js";
import type {
  BeginChangePublicationInput,
  CompleteMergedChangeInput,
  ListChangesInput,
  RecordChangeCleanupInput,
  RecordPublishedPullRequestInput,
} from "../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { storedPublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import { decodeSqliteTaskContextSnapshot } from "./sqliteTaskContextSnapshot.js";

const columns = [
  "id",
  "repository_common_directory AS repositoryCommonDirectory",
  "branch_ref AS branchRef",
  "base_ref AS baseRef",
  "task_id AS taskId",
  "starting_commit AS startingCommit",
  "worktree_path AS worktreePath",
  "acceptance_context AS acceptanceContext",
  "readiness",
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
  "created_at AS createdAt",
  "updated_at AS updatedAt",
  "closed_at AS closedAt",
].join(", ");

export const openSqliteChangePersistence = (): Effect.Effect<
  ChangePersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    getChangeById: (changeId) =>
      repository.transaction("read Change", (sql) => getById(sql, changeId)),
    getChangeByTaskId: (taskId) =>
      repository.transaction("read Change by Task", (sql) => getByTaskId(sql, taskId)),
    listChanges: (input) =>
      repository.transaction("list Changes", (sql) => listChanges(sql, input)),
    listChangesForReconciliation: (commonDirectory) =>
      repository.transaction("list Changes for reconciliation", (sql) =>
        listForReconciliation(sql, commonDirectory),
      ),
    completeMergedChange: (input) =>
      repository.transactionImmediate("complete merged Change", (sql) =>
        completeMergedChange(sql, input),
      ),
    recordCleanup: (input) =>
      repository.transactionImmediate("record Change cleanup", (sql) => recordCleanup(sql, input)),
    beginPublication: (input) =>
      repository.transactionImmediate("begin Change publication", (sql) =>
        beginPublication(sql, input),
      ),
    releasePendingPublication: (input) =>
      repository.transactionImmediate("release Change publication", (sql) =>
        releasePendingPublication(sql, input),
      ),
    recordPublishedPullRequest: (input) =>
      repository.transactionImmediate("record Change publication", (sql) =>
        recordPublishedPullRequest(sql, input),
      ),
  }));

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(`SELECT ${columns} FROM changes WHERE id = ?`, [changeId]),
    (rows) => mapRow(rows[0], "read Change"),
  );

const getByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(`SELECT ${columns} FROM changes WHERE task_id = ?`, [taskId]),
    (rows) => mapRow(rows[0], "read Change by Task"),
  );

const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(
      `SELECT ${columns} FROM changes WHERE repository_common_directory = ? AND (? = 1 OR state = 'open') ORDER BY created_at ASC, id ASC`,
      [input.repositoryCommonDirectory, input.includeClosed ? 1 : 0],
    ),
    (rows) => Effect.forEach(rows, (row) => mapRequiredRow(row, "list Changes")),
  );

const listForReconciliation = (sql: SqlClient.SqlClient, commonDirectory: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(
      `SELECT ${columns} FROM changes WHERE repository_common_directory = ? AND ((state = 'open' AND publication_pr_number IS NOT NULL) OR (state = 'closed' AND cleanup_state = 'pending')) ORDER BY created_at ASC, id ASC`,
      [commonDirectory],
    ),
    (rows) => Effect.forEach(rows, (row) => mapRequiredRow(row, "list Changes for reconciliation")),
  );

const beginPublication = (sql: SqlClient.SqlClient, input: BeginChangePublicationInput) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(yield* getById(sql, input.changeId));
    if (!selected.ok) return selected;
    const change = selected.change;
    if (change.publication !== null) {
      return samePendingPublication(change.publication, input)
        ? { ok: true as const, created: false, change }
        : { ok: false as const, code: "publication_already_owned" as const };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = ${input.candidateId}, publication_validation_run_id = ${input.validationRunId}, publication_owner = ${input.target.owner}, publication_repo = ${input.target.repo}, publication_base_branch = ${input.target.baseBranch}, publication_remote_name = ${input.target.remoteName}, publication_head_branch = ${input.headBranch}, publication_expected_head_sha = ${input.expectedHeadSha}, publication_pr_number = NULL, publication_pr_url = NULL, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      created: true,
      change: yield* requireChange(sql, input.changeId, "begin Change publication"),
    };
  });

const releasePendingPublication = (sql: SqlClient.SqlClient, input: BeginChangePublicationInput) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(yield* getById(sql, input.changeId));
    if (!selected.ok) return selected;
    const publication = selected.change.publication;
    if (publication === null) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    if (!samePendingPublication(publication, input)) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = NULL, publication_validation_run_id = NULL, publication_owner = NULL, publication_repo = NULL, publication_base_branch = NULL, publication_remote_name = NULL, publication_head_branch = NULL, publication_expected_head_sha = NULL, publication_pr_number = NULL, publication_pr_url = NULL, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      change: yield* requireChange(sql, input.changeId, "release Change publication"),
    };
  });

const recordPublishedPullRequest = (
  sql: SqlClient.SqlClient,
  input: RecordPublishedPullRequestInput,
) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(yield* getById(sql, input.changeId));
    if (!selected.ok) return selected;
    const change = selected.change;
    if (!canRecordPublication(change.publication, input)) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = ${input.candidateId}, publication_validation_run_id = ${input.validationRunId}, publication_expected_head_sha = ${input.expectedHeadSha}, publication_pr_number = ${input.pullRequest.number}, publication_pr_url = ${input.pullRequest.url}, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      change: yield* requireChange(sql, input.changeId, "record Change publication"),
    };
  });

const completeMergedChange = (sql: SqlClient.SqlClient, input: CompleteMergedChangeInput) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed)
      return change.closeReason === "completed"
        ? { ok: true as const, changed: false, change }
        : { ok: false as const, code: "change_already_closed" as const };
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'completed', cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'done', updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return {
      ok: true as const,
      changed: true,
      change: yield* requireChange(sql, input.changeId, "complete merged Change"),
    };
  });

const recordCleanup = (sql: SqlClient.SqlClient, input: RecordChangeCleanupInput) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state !== changeState.closed)
      return { ok: false as const, code: "change_not_closed" as const };
    const changed = cleanupChanged(change.cleanup, input.cleanup);
    let recorded = change;
    if (changed) {
      yield* sql`UPDATE changes SET cleanup_state = ${input.cleanup.state}, cleanup_blocking_reason = ${input.cleanup.blockingReason}, updated_at = ${input.now} WHERE id = ${input.changeId}`;
      recorded = yield* requireChange(sql, input.changeId, "record Change cleanup");
    }
    return { ok: true as const, changed, change: recorded };
  });

const requireChange = (sql: SqlClient.SqlClient, id: string, operationName: string) =>
  Effect.flatMap(getById(sql, id), (change) =>
    change === undefined
      ? invalidData(operationName, "Change disappeared")
      : Effect.succeed(change),
  );

const selectOpenChange = (
  change: ChangeRecord | undefined,
):
  | { readonly ok: true; readonly change: ChangeRecord }
  | { readonly ok: false; readonly code: "change_not_found" | "change_closed" } => {
  if (change === undefined) return { ok: false, code: "change_not_found" };
  return change.state === changeState.closed
    ? { ok: false, code: "change_closed" }
    : { ok: true, change };
};

const canRecordPublication = (
  publication: ChangePublication | null,
  input: RecordPublishedPullRequestInput,
): boolean =>
  publication !== null &&
  samePublicationTarget(publication, input) &&
  canRecord(publication, input);

const samePublicationTarget = (
  publication: ChangePublication,
  input: RecordPublishedPullRequestInput,
): boolean =>
  sameTarget(publication.target, input.target) && publication.headBranch === input.headBranch;

const samePendingPublication = (
  publication: ChangePublication,
  input: BeginChangePublicationInput,
): boolean =>
  publication.pullRequest === null &&
  samePublicationEvidence(publication, input) &&
  samePublicationBinding(publication, input);

const samePublicationEvidence = (
  publication: ChangePublication,
  input: BeginChangePublicationInput,
): boolean =>
  publication.candidateId === input.candidateId &&
  publication.validationRunId === input.validationRunId;

const samePublicationBinding = (
  publication: ChangePublication,
  input: BeginChangePublicationInput,
): boolean =>
  sameTarget(publication.target, input.target) &&
  publication.headBranch === input.headBranch &&
  publication.expectedHeadSha === input.expectedHeadSha;

const cleanupChanged = (left: ChangeCleanup, right: ChangeCleanup): boolean =>
  left.state !== right.state || left.blockingReason !== right.blockingReason;

const canRecord = (
  publication: ChangePublication,
  input: RecordPublishedPullRequestInput,
): boolean =>
  input.previousExpectedHeadSha === undefined
    ? input.previousCandidateId === undefined &&
      input.previousValidationRunId === undefined &&
      publication.pullRequest === null &&
      publication.candidateId === input.candidateId &&
      publication.validationRunId === input.validationRunId
    : input.previousCandidateId !== undefined &&
      input.previousValidationRunId !== undefined &&
      publication.pullRequest !== null &&
      publication.pullRequest.number === input.pullRequest.number &&
      publication.expectedHeadSha === input.previousExpectedHeadSha &&
      publication.candidateId === input.previousCandidateId &&
      publication.validationRunId === input.previousValidationRunId;

const sameTarget = (
  left: ChangePublication["target"],
  right: ChangePublication["target"],
): boolean =>
  left.owner === right.owner &&
  left.repo === right.repo &&
  left.baseBranch === right.baseBranch &&
  left.remoteName === right.remoteName;

const mapRequiredRow = (row: ChangeRow, operationName: string) =>
  Effect.flatMap(mapRow(row, operationName), (change) =>
    change === undefined
      ? invalidData(operationName, "Change row disappeared")
      : Effect.succeed(change),
  );
const mapRow = (row: ChangeRow | undefined, operationName: string) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.try({
        try: (): ChangeRecord => ({
          id: row.id,
          repositoryCommonDirectory: row.repositoryCommonDirectory,
          branchRef: row.branchRef,
          baseRef: row.baseRef,
          taskId: row.taskId === null ? null : storedPublicTaskId(row.taskId),
          startingCommit: row.startingCommit,
          worktreePath: row.worktreePath,
          acceptanceContext:
            row.acceptanceContext === null
              ? null
              : decodeSqliteTaskContextSnapshot(row.acceptanceContext),
          readiness: row.readiness,
          prepare:
            row.prepareCommand === null || row.prepareTimeoutSeconds === null
              ? null
              : { command: row.prepareCommand, timeoutSeconds: row.prepareTimeoutSeconds },
          prepareFailure:
            row.prepareFailure === null
              ? null
              : decodeSqliteChangePrepareFailure(row.prepareFailure),
          publication: decodeSqliteChangePublication(row),
          cleanup: { state: row.cleanupState, blockingReason: row.cleanupBlockingReason },
          state: row.state,
          closeReason: row.closeReason,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          closedAt: row.closedAt,
        }),
        catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
      });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type ChangeRow = Omit<
  ChangeRecord,
  "taskId" | "acceptanceContext" | "prepare" | "prepareFailure" | "publication"
> & {
  readonly taskId: string | null;
  readonly acceptanceContext: string | null;
  readonly prepareCommand: string | null;
  readonly prepareTimeoutSeconds: number | null;
  readonly prepareFailure: string | null;
  readonly cleanupState: ChangeCleanup["state"];
  readonly cleanupBlockingReason: string | null;
} & SqliteChangePublicationRow;
