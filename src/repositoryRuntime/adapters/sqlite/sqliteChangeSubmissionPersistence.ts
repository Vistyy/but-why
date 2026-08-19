import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangeRecord } from "../../../change/change.js";
import { internalChangeId, publicChangeId } from "../../../change/changeId.js";
import type { ChangeSubmissionPort, SubmissionChange } from "../../../change/changePorts.js";
import { deriveAcceptanceContext } from "../../../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeImplementationDecisions,
  readImplementationBlockerHistory,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import {
  changeReadColumns,
  decodeChangeRow,
  type StoredChangeRow,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import { completeMergedChange as completeChangeOnly } from "./sqliteCompleteMergedChangeStorage.js";
import { readCompletedCandidatePublicationEvidence } from "./sqlitePassingValidationEvidence.js";
import { decodePersisted } from "./sqlitePersistedData.js";

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
  policy: change.policy,
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
