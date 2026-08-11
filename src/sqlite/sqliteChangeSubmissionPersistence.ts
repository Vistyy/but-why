import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangePublication, type ChangeRecord, changeState } from "../change/change.js";
import type { ChangeSubmissionPort, SubmissionChange } from "../change/changePorts.js";
import type { CompleteMergedChangeInput } from "../change/changeStore.js";
import type { ObservedMergedChangeEvidence } from "../change/ownedPullRequestClassifier.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import type { SqliteChangePublicationRow } from "./sqliteChangePublication.js";
import {
  changeReadColumns,
  decodeChangePublication,
  decodeChangeRow,
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type StoredChangeRow,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
  validateChangePublicationRelationships,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeLifecycle,
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { readCompletedCandidatePublicationEvidence } from "./sqlitePassingValidationEvidence.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeSubmissionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeSubmissionPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for submission", (sql) =>
          readSubmissionChange(sql, changeId),
        ),
      getChangeForOutputById: (changeId) =>
        repository.transaction("read Change for Submit output", (sql) => getById(sql, changeId)),
      getCompletedPublicationEvidence: (changeId, candidateId, validationRunId) =>
        repository.transaction("read completed Candidate Publication evidence", (sql) =>
          readCompletedCandidatePublicationEvidence(sql, changeId, candidateId, validationRunId),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.map(completeMergedChange(sql, input), (result) =>
            result.ok ? { ...result, changeId: input.changeId } : result,
          ),
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
  publication_pr_number AS publicationPrNumber,
  publication_pr_url AS publicationPrUrl
`;
const readActiveBlocker = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.map(
    readSelectedBlockers(sql, changeId, operationName, "change_id = ? AND resolved_at IS NULL", [
      changeId,
    ]),
    (history) => history.active,
  );
const readSelectedBlockers = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  predicate: string,
  parameters: readonly unknown[],
) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE ${predicate}`,
      parameters,
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );
const readSubmissionChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "read Change for submission";
    const rows = yield* sql.unsafe<StoredSubmissionChangeRow>(
      `SELECT ${publicationSelectionColumns}, branch_ref AS branchRef, base_ref AS baseRef,
        base_remote_url AS baseRemoteUrl, worktree_path AS worktreePath,
        acceptance_context AS acceptanceContext
       FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => {
      const baseRef = decodeStoredNullableString(row.baseRef, "Change Base ref");
      const baseRemoteUrl = decodeStoredNullableString(row.baseRemoteUrl, "Change Base remote URL");
      const worktreePath = decodeStoredNullableString(row.worktreePath, "Change worktree path");
      if (worktreePath !== null && (baseRef === null || baseRemoteUrl === null)) {
        throw new Error("Stored managed Change submission facts are incomplete");
      }
      return {
        ...decodeSelectedChangeState(row, changeId),
        branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
        baseRef,
        baseRemoteUrl,
        worktreePath,
        acceptanceContext: decodeSelectedAcceptanceContext(
          decodeStoredNullableString(row.acceptanceContext, "Change Acceptance Context"),
        ),
        publication: decodeChangePublication(row),
      } satisfies SubmissionChange;
    });
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });
const decodeSelectedAcceptanceContext = (value: string | null) =>
  value === null ? null : decodeSqliteAcceptanceContextSnapshot(value);
const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );
const readChangeLifecycle = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredChangeLifecycleRow>`
      SELECT id, state, close_reason AS closeReason
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
    const rows = yield* sql.unsafe<
      PublicationSelectionRow & StoredChangeLifecycleRow & { readonly taskId: unknown }
    >(
      `SELECT ${publicationSelectionColumns}, close_reason AS closeReason, task_id AS taskId
       FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => ({
      ...decodeSelectedChangeLifecycle(row, changeId),
      taskId: decodeStoredNullableString(row.taskId, "Change Task id"),
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
const decodeSelectedChangeState = (row: StoredChangeStateRow, changeId: string) => {
  const id = decodeStoredString(row.id, "Change id");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row.state) };
};
const decodeSelectedChangeLifecycle = (row: StoredChangeLifecycleRow, changeId: string) => ({
  id: decodeSelectedChangeState(row, changeId).id,
  ...decodeChangeLifecycle(row),
});
const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, sequence,
        recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeId}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId),
      ),
  );
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
const mapRow = (
  row: StoredChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  Effect.flatMap(mapChangeWithoutHistoryRow(row, operationName, sql), (changeWithoutHistory) =>
    changeWithoutHistory === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const decisions = yield* listDecisions(sql, changeWithoutHistory.id);
          const activeBlocker = yield* readActiveBlocker(
            sql,
            changeWithoutHistory.id,
            operationName,
          );
          return {
            ...changeWithoutHistory,
            implementationDecisions: decisions,
            activeBlocker,
          } satisfies ChangeRecord;
        }),
  );
const mapChangeWithoutHistoryRow = (
  row: StoredChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.gen(function* () {
        const change = yield* decodePersisted(operationName, () => decodeChangeRow(row));
        yield* validateChangeRelationships(sql, change, operationName);
        return change;
      });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
type StoredChangeStateRow = {
  readonly id: unknown;
  readonly state: unknown;
};
type StoredChangeLifecycleRow = StoredChangeStateRow & {
  readonly closeReason: unknown;
};
type PublicationSelectionRow = StoredChangeStateRow & SqliteChangePublicationRow;
type StoredSubmissionChangeRow = StoredChangeStateRow &
  SqliteChangePublicationRow & {
    readonly branchRef: unknown;
    readonly baseRef: unknown;
    readonly baseRemoteUrl: unknown;
    readonly worktreePath: unknown;
    readonly acceptanceContext: unknown;
  };
