import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangeRecord } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { ChangeSubmissionPort, SubmissionChange } from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  changeReadColumns,
  decodeChangeRow,
  decodeImplementationDecisions,
  deriveAcceptanceContext,
  readImplementationBlockerHistory,
  type StoredChangeRow,
  type StoredImplementationDecisionRow,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import { completeMergedChange as completeChangeOnly } from "./sqliteCompleteMergedChangeStorage.js";
import { readCompletedCandidatePublicationEvidence } from "./sqlitePassingValidationEvidence.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeSubmissionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeSubmissionPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for submission", (sql) =>
          Effect.map(readFullChange(sql, changeId, repository.idPrefix), (change) =>
            change === undefined ? undefined : submissionChange(change),
          ),
        ),
      agentSessionConfigurationCanBeCorrected: (changeId, producer) =>
        repository.transaction("check Change Agent configuration correction", (sql) =>
          agentSessionConfigurationCanBeCorrected(sql, changeId, producer, repository.idPrefix),
        ),
      getChangeForOutputById: (changeId) =>
        repository.transaction("read Change for Submit output", (sql) =>
          readFullChange(sql, changeId, repository.idPrefix),
        ),
      getCompletedPublicationEvidence: (changeId, candidateId, validationRunId) =>
        repository.transaction("read completed Candidate Publication evidence", (sql) =>
          readCompletedCandidatePublicationEvidence(
            sql,
            changeId,
            candidateId,
            validationRunId,
            repository.idPrefix,
          ),
        ),
      completeMergedChange: (input) =>
        repository.transactionImmediate("complete merged Change", (sql) =>
          Effect.gen(function* () {
            const result = yield* completeChangeOnly(sql, input, repository.idPrefix);
            if (!result.ok) return result;
            const changeId = yield* readCommittedCompletionId(
              sql,
              input.changeId,
              repository.idPrefix,
            );
            return { ...result, changeId };
          }),
        ),
    }),
  );

const submissionChange = (change: ChangeRecord): SubmissionChange => ({
  id: change.id,
  state: change.state,
  activeBlocker: change.activeBlocker,
  branchRef: change.branchRef,
  baseRef: change.baseRef,
  baseRemoteUrl: change.baseRemoteUrl,
  worktreePath: change.worktreePath,
  acceptanceContext: change.acceptanceContext,
  reviewerConfiguration: change.reviewerConfiguration,
  publication: change.publication,
});

const readFullChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredChangeRow>(
      `SELECT ${changeReadColumns} FROM changes WHERE id = ?`,
      [internalChangeId(changeId, idPrefix)],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const change = yield* decodePersisted("read Change", () => decodeChangeRow(row, idPrefix));
    yield* validateChangePublicationRelationships(
      sql,
      change.id,
      change.publication,
      "read Change",
      idPrefix,
    );
    const decisions = yield* listDecisions(sql, change.id, idPrefix);
    const blockers = yield* readImplementationBlockerHistory(
      sql,
      change.id,
      "read Change",
      idPrefix,
    );
    return {
      ...change,
      acceptanceContext: deriveAcceptanceContext(change.acceptanceContext, blockers),
      implementationDecisions: decisions,
      activeBlocker: blockers.active,
    } satisfies ChangeRecord;
  });

const listDecisions = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${internalChangeId(changeId, idPrefix)}
      ORDER BY id
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId, idPrefix),
      ),
  );

const agentSessionConfigurationCanBeCorrected = (
  sql: SqlClient.SqlClient,
  changeId: string,
  producer: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const sessions = yield* sql<{ readonly agentSessionId: number }>`
      SELECT agent_session_id AS agentSessionId
      FROM change_agent_sessions
      WHERE change_id = ${internalChangeId(changeId, idPrefix)} AND producer = ${producer}
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
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
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
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
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

const readCommittedCompletionId = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const operationName = "complete merged Change";
    const rows = yield* sql<{ readonly id: number }>`
      SELECT id FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    const row = rows[0];
    if (row === undefined) return yield* invalidData(operationName, "Change disappeared");
    return yield* decodePersisted(operationName, () => {
      const committedId = publicChangeId(idPrefix, row.id);
      if (committedId !== changeId) throw new Error("Change identity does not match lookup");
      return committedId;
    });
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
