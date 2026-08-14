import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeRecord } from "../change/change.js";
import type { ChangeSubmissionPort, SubmissionChange } from "../change/changePorts.js";
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
  deriveAcceptanceContext,
  implementationBlockerReadColumns,
  readImplementationBlockerHistory,
  type StoredChangeRow,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
  validateChangePublicationRelationships,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { completeMergedChange } from "./sqliteCompleteMergedChangeStorage.js";
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
      agentSessionConfigurationCanBeCorrected: (changeId, producer) =>
        repository.transaction("check Change Agent configuration correction", (sql) =>
          agentSessionConfigurationCanBeCorrected(sql, changeId, producer),
        ),
      getChangeForOutputById: (changeId) =>
        repository.transaction("read Change for Submit output", (sql) => getById(sql, changeId)),
      getCompletedPublicationEvidence: (changeId, candidateId, validationRunId) =>
        repository.transaction("read completed Candidate Publication evidence", (sql) =>
          readCompletedCandidatePublicationEvidence(sql, changeId, candidateId, validationRunId),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeMergedChange(sql, input);
            if (!result.ok) return result;
            const changeId = yield* readCommittedCompletionId(sql, input.changeId);
            return { ...result, changeId };
          }),
        ),
    }),
  );
const agentSessionConfigurationCanBeCorrected = (
  sql: SqlClient.SqlClient,
  changeId: string,
  producer: string,
) =>
  Effect.gen(function* () {
    const sessions = yield* sql<{ readonly agentSessionId: number }>`
      SELECT agent_session_id AS agentSessionId
      FROM change_agent_sessions
      WHERE change_id = ${changeId} AND producer = ${producer}
    `;
    const sessionId = sessions[0]?.agentSessionId;
    if (sessionId === undefined) return false;
    const latest = yield* sql<{
      readonly settlementKind: string | null;
      readonly transcriptPath: string | null;
    }>`
      SELECT invocation.settlement_kind AS settlementKind,
        continuation.transcript_path AS transcriptPath
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation
        ON continuation.id = invocation.continuation_id
      WHERE continuation.agent_session_id = ${sessionId}
      ORDER BY invocation.id DESC LIMIT 1
    `;
    const transcript = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM agent_continuations
      WHERE agent_session_id = ${sessionId} AND transcript_path IS NOT NULL
    `;
    const returned = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation
        ON continuation.id = invocation.continuation_id
      WHERE continuation.agent_session_id = ${sessionId}
        AND invocation.settlement_kind = 'returned'
    `;
    return (
      latest[0]?.settlementKind === "launch_failed" &&
      latest[0]?.transcriptPath === null &&
      (transcript[0]?.count ?? 0) === 0 &&
      (returned[0]?.count ?? 0) === 0
    );
  });

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
        acceptance_context AS acceptanceContext,
        reviewer_configuration AS reviewerConfiguration
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
        reviewerConfiguration: decodeReviewerConfiguration(row.reviewerConfiguration),
        publication: decodeChangePublication(row),
      };
    });
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    const blockerHistory = yield* readImplementationBlockerHistory(sql, selected.id, operationName);
    const activeBlocker = blockerHistory.active;
    return {
      ...selected,
      acceptanceContext: deriveAcceptanceContext(selected.acceptanceContext, blockerHistory),
      activeBlocker,
    } satisfies SubmissionChange;
  });
const readCommittedCompletionId = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "complete merged Change";
    const rows = yield* sql<{ readonly id: unknown }>`
      SELECT id FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return yield* invalidData(operationName, "Change disappeared");
    return yield* decodePersisted(operationName, () => {
      const committedId = decodeStoredString(row.id, "Change id");
      if (committedId !== changeId) throw new Error("Change identity does not match lookup");
      return committedId;
    });
  });
const decodeSelectedAcceptanceContext = (value: string | null) =>
  value === null ? null : decodeSqliteAcceptanceContextSnapshot(value);
const decodeReviewerConfiguration = (value: unknown) => {
  const encoded = decodeStoredNullableString(value, "Change Reviewer Configuration");
  if (encoded === null) return null;
  const decoded: unknown = JSON.parse(encoded) as unknown;
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !Array.isArray((decoded as { specialistReviews?: unknown }).specialistReviews)
  ) {
    throw new Error("Stored Change Reviewer Configuration is invalid");
  }
  return decoded as import("../change/changeStartStore.js").ChangeReviewerConfiguration;
};
const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );
const decodeSelectedChangeState = (row: StoredChangeStateRow, changeId: string) => {
  const id = decodeStoredString(row.id, "Change id");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return { id, state: decodeChangeState(row.state) };
};
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
type StoredSubmissionChangeRow = StoredChangeStateRow &
  SqliteChangePublicationRow & {
    readonly branchRef: unknown;
    readonly baseRef: unknown;
    readonly baseRemoteUrl: unknown;
    readonly worktreePath: unknown;
    readonly acceptanceContext: unknown;
    readonly reviewerConfiguration: unknown;
  };
