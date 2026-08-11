import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import {
  type ChangeCleanup,
  type ChangePublication,
  type ChangeRecord,
  changeState,
} from "../change/change.js";
import type {
  CandidatePublicationPort,
  ChangeAuthorityPort,
  ChangeCancellationPort,
  ChangeDeliveryPort,
  ChangePublicationEvidence,
  ChangeReadPort,
  ChangeReconciliationPort,
  ChangeReviewerSessionPort,
  ChangeReviewerTranscriptPort,
  ChangeSubmissionPort,
  CompletedPublicationEvidencePort,
  CurrentChangeEvidenceQuery,
  RecordImplementationDecisionInput,
  TerminalChangeCleanupPort,
} from "../change/changePorts.js";
import type {
  BeginChangePublicationInput,
  CancelChangeInput,
  CompleteMergedChangeInput,
  ListChangesInput,
  RecordChangeCleanupInput,
  RecordPublishedPullRequestInput,
  ReplacePendingChangePublicationInput,
} from "../change/changeStore.js";
import type { ObservedMergedChangeEvidence } from "../change/ownedPullRequestClassifier.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import {
  decodeValidationRun,
  decodeValidationRunPolicy,
  type UnknownValidationRunRow,
  validateValidationRunImplementationDecisionRelationships,
  validateValidationRunLatestResolvedBlockerRelationship,
} from "./sqliteCandidateValidationReadModel.js";
import {
  changeReadColumns,
  decodeChangePublication,
  decodeChangeRow,
  decodeChangeState,
  decodeCloseReason,
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  decodeReviewerSession,
  decodeReviewerTranscript,
  implementationBlockerReadColumns,
  type UnknownChangeRow,
  type UnknownImplementationBlockerRow,
  type UnknownImplementationDecisionRow,
  validateChangePublicationRelationships,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredSqlitePositiveInteger,
  decodeStoredString,
} from "./sqliteTaskReadModel.js";

const makeSqliteChangeAdapter = (
  repository: import("effect").Context.Tag.Service<typeof RepositorySql>,
): ChangeAuthorityPort &
  ChangeReadPort &
  ChangeDeliveryPort &
  ChangeReviewerSessionPort &
  ChangeReviewerTranscriptPort &
  CandidatePublicationPort &
  CompletedPublicationEvidencePort => ({
  raiseImplementationBlocker: (input) =>
    repository.transactionImmediate("raise Implementation Blocker", (sql) =>
      raiseBlocker(sql, input),
    ),
  resolveImplementationBlocker: (input) =>
    repository.transactionImmediate("resolve Implementation Blocker", (sql) =>
      resolveBlocker(sql, input),
    ),
  listImplementationBlockers: (changeId) =>
    repository.transaction("list Implementation Blockers", (sql) => listBlockers(sql, changeId)),
  getChangeById: (changeId) =>
    repository.transaction("read Change", (sql) => getById(sql, changeId)),
  getChangeByTaskId: (taskId) =>
    repository.transaction("read Change by Task", (sql) => getByTaskId(sql, taskId)),
  listImplementationDecisions: (changeId) =>
    repository.transaction("list Implementation Decisions", (sql) => listDecisions(sql, changeId)),
  recordImplementationDecision: (input) =>
    repository.transactionImmediate("record Implementation Decision", (sql) =>
      recordDecision(sql, input),
    ),
  getCurrentPassingEvidence: (changeId, query) =>
    repository.transaction("read current passing Change evidence", (sql) =>
      getPassingEvidence(sql, changeId, query, false),
    ),
  getCompletedPublicationEvidence: (changeId, candidateId, validationRunId) =>
    repository.transaction("read completed Candidate Publication evidence", (sql) =>
      getPassingEvidence(sql, changeId, { candidateId, validationRunId }, true),
    ),
  listChanges: (input) => repository.transaction("list Changes", (sql) => listChanges(sql, input)),
  listChangesForReconciliation: (commonDirectory) =>
    repository.transaction("list Changes for reconciliation", (sql) =>
      listForReconciliation(sql, commonDirectory),
    ),
  completeMergedChange: (input) =>
    repository.transactionImmediate("complete merged Change", (sql) =>
      completeMergedChange(sql, input),
    ),
  cancelChange: (input) =>
    repository.transactionImmediate("cancel Change", (sql) => cancelChange(sql, input)),
  recordCleanup: (input) =>
    repository.transactionImmediate("record Change cleanup", (sql) => recordCleanup(sql, input)),
  getReviewerSession: (changeId, producer) =>
    repository.transaction("read Reviewer Session", (sql) =>
      Effect.flatMap(
        sql<
          Record<string, unknown>
        >`SELECT change_id AS changeId, producer, fingerprint, session_reference AS sessionReference FROM reviewer_sessions WHERE change_id = ${changeId} AND producer = ${producer}`,
        (rows) => {
          const row = rows[0];
          return row === undefined
            ? Effect.succeed(undefined)
            : decodePersisted("read Reviewer Session", () => decodeReviewerSession(row, changeId));
        },
      ),
    ),
  saveReviewerSession: (input) =>
    repository.transactionImmediate("save Reviewer Session", (sql) =>
      Effect.asVoid(sql`
      INSERT INTO reviewer_sessions (change_id, producer, fingerprint, session_reference)
      VALUES (${input.changeId}, ${input.producer}, ${input.fingerprint}, ${input.sessionReference})
      ON CONFLICT(change_id, producer) DO UPDATE SET fingerprint = excluded.fingerprint, session_reference = excluded.session_reference
    `),
    ),
  removeReviewerSession: (changeId, producer) =>
    repository.transactionImmediate("remove Reviewer Session", (sql) =>
      Effect.asVoid(
        sql`DELETE FROM reviewer_sessions WHERE change_id = ${changeId} AND producer = ${producer}`,
      ),
    ),
  removeReviewerSessions: (changeId) =>
    repository.transactionImmediate("remove Reviewer Sessions", (sql) =>
      Effect.asVoid(sql`DELETE FROM reviewer_sessions WHERE change_id = ${changeId}`),
    ),
  listReviewerTranscripts: (changeId) =>
    repository.transaction("list Reviewer Transcripts", (sql) =>
      Effect.flatMap(
        sql<
          Record<string, unknown>
        >`SELECT change_id AS changeId, producer, pi_session_id AS piSessionId, file_path AS filePath FROM reviewer_transcripts WHERE change_id = ${changeId}`,
        (rows) =>
          decodePersisted("list Reviewer Transcripts", () =>
            rows
              .map((row) => decodeReviewerTranscript(row, changeId))
              .sort(
                (left, right) =>
                  compareStoredStrings(left.producer, right.producer) ||
                  compareStoredStrings(left.filePath, right.filePath),
              ),
          ),
      ),
    ),
  recordReviewerTranscripts: (input) =>
    repository.transactionImmediate("record Reviewer Transcripts", (sql) =>
      input.transcripts.length === 0
        ? Effect.void
        : Effect.asVoid(
            sql`
      INSERT INTO reviewer_transcripts
      ${sql.insert(
        input.transcripts.map((transcript) => ({
          change_id: input.changeId,
          producer: transcript.producer,
          pi_session_id: transcript.piSessionId,
          file_path: transcript.filePath,
        })),
      )}
      ON CONFLICT(change_id, producer, file_path) DO NOTHING
    `,
          ),
    ),
  beginPublication: (input) =>
    repository.transactionImmediate("begin Change publication", (sql) =>
      beginPublication(sql, input),
    ),
  replacePendingPublication: (input) =>
    repository.transactionImmediate("replace pending Change publication", (sql) =>
      replacePendingPublication(sql, input),
    ),
  releasePendingPublication: (input) =>
    repository.transactionImmediate("release Change publication", (sql) =>
      releasePendingPublication(sql, input),
    ),
  recordPublishedPullRequest: (input) =>
    repository.transactionImmediate("record Change publication", (sql) =>
      recordPublishedPullRequest(sql, input),
    ),
});

export const openSqliteChangeAuthorityPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      raiseImplementationBlocker: adapter.raiseImplementationBlocker,
      resolveImplementationBlocker: adapter.resolveImplementationBlocker,
      listImplementationBlockers: adapter.listImplementationBlockers,
      listImplementationDecisions: adapter.listImplementationDecisions,
      recordImplementationDecision: adapter.recordImplementationDecision,
      getCurrentPassingEvidence: adapter.getCurrentPassingEvidence,
    };
  });

export const openSqliteChangeReadPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      getChangeById: adapter.getChangeById,
      getChangeByTaskId: adapter.getChangeByTaskId,
      listChanges: adapter.listChanges,
    };
  });

export const openSqliteChangeDeliveryPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      listChangesForReconciliation: adapter.listChangesForReconciliation,
      completeMergedChange: adapter.completeMergedChange,
      cancelChange: adapter.cancelChange,
      recordCleanup: adapter.recordCleanup,
    };
  });

export const openSqliteChangeSubmissionPort = () =>
  Effect.map(RepositorySql, (repository): ChangeSubmissionPort => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      getChangeById: (changeId) =>
        repository.transaction("read Change for submission", (sql) =>
          getBaseById(sql, changeId, "read Change for submission"),
        ),
      getCompletedPublicationEvidence: adapter.getCompletedPublicationEvidence,
      completeMergedChange: adapter.completeMergedChange,
    };
  });

export const openSqliteChangeReconciliationPort = () =>
  Effect.map(RepositorySql, (repository): ChangeReconciliationPort => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      getChangeById: (changeId) =>
        repository.transaction("read Change for reconciliation", (sql) =>
          getBaseById(sql, changeId, "read Change for reconciliation"),
        ),
      listChangesForReconciliation: adapter.listChangesForReconciliation,
      completeMergedChange: adapter.completeMergedChange,
    };
  });

export const openSqliteChangeCancellationPort = () =>
  Effect.map(RepositorySql, (repository): ChangeCancellationPort => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      getChangeById: (changeId) =>
        repository.transaction("read Change for cancellation", (sql) =>
          getBaseById(sql, changeId, "read Change for cancellation"),
        ),
      getChangeByTaskId: (taskId) =>
        repository.transaction("read Change by Task for cancellation", (sql) =>
          getBaseByTaskId(sql, taskId, "read Change by Task for cancellation"),
        ),
      completeMergedChange: adapter.completeMergedChange,
      cancelChange: adapter.cancelChange,
    };
  });

export const openSqliteTerminalChangeCleanupPort = () =>
  Effect.map(RepositorySql, (repository): TerminalChangeCleanupPort => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      recordCleanup: adapter.recordCleanup,
      removeReviewerSessions: adapter.removeReviewerSessions,
    };
  });

export const openSqliteChangeReviewerSessionPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      getReviewerSession: adapter.getReviewerSession,
      saveReviewerSession: adapter.saveReviewerSession,
      removeReviewerSession: adapter.removeReviewerSession,
      removeReviewerSessions: adapter.removeReviewerSessions,
    };
  });

export const openSqliteChangeReviewerTranscriptPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      listReviewerTranscripts: adapter.listReviewerTranscripts,
      recordReviewerTranscripts: adapter.recordReviewerTranscripts,
    };
  });

export const openSqliteCandidatePublicationPort = () =>
  Effect.map(RepositorySql, (repository) => {
    const adapter = makeSqliteChangeAdapter(repository);
    return {
      getChangeById: (changeId: string) =>
        repository.transaction("read Change for publication", (sql) =>
          getPublicationById(sql, changeId),
        ),
      getCurrentPassingEvidence: adapter.getCurrentPassingEvidence,
      beginPublication: adapter.beginPublication,
      replacePendingPublication: adapter.replacePendingPublication,
      releasePendingPublication: adapter.releasePendingPublication,
      recordPublishedPullRequest: adapter.recordPublishedPullRequest,
    };
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
  CAST(publication_pr_number AS TEXT) AS publicationPrNumber,
  typeof(publication_pr_number) AS publicationPrNumberType,
  publication_pr_url AS publicationPrUrl
`;

const raiseBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const change = yield* readChangeState(sql, input.changeId, "raise Implementation Blocker");
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed)
      return { ok: false as const, code: "change_not_open" as const };
    const active = yield* readActiveBlocker(sql, input.changeId, "raise Implementation Blocker");
    if (active !== null) return { ok: false as const, code: "change_blocked" as const };
    const id = randomUUID();
    yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content) VALUES (${id}, ${input.changeId}, ${input.now}, ${input.content})`;
    const updated = yield* requireBaseChange(sql, input.changeId, "raise Implementation Blocker");
    const stored = yield* readBlockerById(sql, input.changeId, id, "raise Implementation Blocker");
    if (stored === undefined)
      return yield* invalidData("raise Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, change: { ...updated, activeBlocker: stored }, blocker: stored };
  });

const resolveBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const selected = yield* readChangeState(sql, input.changeId, "resolve Implementation Blocker");
    if (selected === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (selected.state === changeState.closed)
      return { ok: false as const, code: "no_active_blocker" as const };
    const change = yield* readBlockerResolutionChange(sql, input.changeId);
    if (change === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Change disappeared");
    const blocker = yield* readActiveBlocker(sql, input.changeId, "resolve Implementation Blocker");
    if (blocker === null) return { ok: false as const, code: "no_active_blocker" as const };
    const resolutionId = randomUUID();
    yield* sql`UPDATE implementation_blockers SET resolved_at = ${input.now}, resolution_id = ${resolutionId}, resolution_recorded_at = ${input.now}, resolution_content = ${input.content} WHERE id = ${blocker.id}`;
    if (change.taskId !== null && change.acceptanceContext !== null) {
      yield* sql`UPDATE changes SET acceptance_context = json_set(acceptance_context, '$.resolutions', json_insert(COALESCE(json_extract(acceptance_context, '$.resolutions'), '[]'), '$[#]', ${input.content})), updated_at = ${input.now} WHERE id = ${input.changeId}`;
    }
    const updated = yield* requireBaseChange(sql, input.changeId, "resolve Implementation Blocker");
    const resolved = yield* readBlockerById(
      sql,
      input.changeId,
      blocker.id,
      "resolve Implementation Blocker",
    );
    if (resolved === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, change: { ...updated, activeBlocker: null }, blocker: resolved };
  });

const listBlockers = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const exists = yield* sql<
      Record<string, unknown>
    >`SELECT id FROM changes WHERE id = ${changeId}`;
    if (exists.length === 0) return undefined;
    yield* decodePersisted("list Implementation Blockers", () =>
      decodeStoredString(exists[0]?.["id"], "Change ID"),
    );
    return yield* readBlockers(sql, changeId, "list Implementation Blockers");
  });

const readBlockers = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE change_id = ?`,
      [changeId],
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );

const readActiveBlocker = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.map(
    readSelectedBlockers(sql, changeId, operationName, "change_id = ? AND resolved_at IS NULL", [
      changeId,
    ]),
    (history) => history.active,
  );

const readBlockerById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  blockerId: string,
  operationName: string,
) =>
  Effect.map(
    readSelectedBlockers(sql, changeId, operationName, "change_id = ? AND id = ?", [
      changeId,
      blockerId,
    ]),
    (history) => history.blockers[0],
  );

const readLatestResolvedBlockerId = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  resolvedAtOrBefore?: string,
) =>
  Effect.gen(function* () {
    const upperBound = resolvedAtOrBefore === undefined ? "" : "AND resolved_at <= ?";
    const rows = yield* sql.unsafe<{
      readonly id: unknown;
      readonly changeId: unknown;
      readonly sequence: unknown;
      readonly sequenceType: unknown;
      readonly resolvedAt: unknown;
      readonly resolutionId: unknown;
      readonly resolutionRecordedAt: unknown;
      readonly resolutionContent: unknown;
    }>(
      `SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, resolved_at AS resolvedAt,
        resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt,
        resolution_content AS resolutionContent
       FROM implementation_blockers
       WHERE change_id = ? AND resolved_at IS NOT NULL ${upperBound}
       ORDER BY resolved_at DESC, sequence DESC LIMIT 1`,
      resolvedAtOrBefore === undefined ? [changeId] : [changeId, resolvedAtOrBefore],
    );
    return yield* decodePersisted(operationName, () => {
      const row = rows[0];
      if (row === undefined) return null;
      const owner = decodeStoredString(row.changeId, "Implementation Blocker Change ID");
      if (owner !== changeId) throw new Error("Implementation Blocker belongs to another Change");
      decodeStoredSqlitePositiveInteger(
        row.sequence,
        row.sequenceType,
        "Implementation Blocker sequence",
      );
      decodeStoredString(row.resolvedAt, "Implementation Blocker resolution time");
      decodeStoredString(row.resolutionId, "Resolution ID");
      decodeStoredString(row.resolutionRecordedAt, "Resolution recorded time");
      decodeStoredString(row.resolutionContent, "Resolution content");
      return decodeStoredString(row.id, "Implementation Blocker ID");
    });
  });

const readSelectedBlockers = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  predicate: string,
  parameters: readonly unknown[],
) =>
  Effect.flatMap(
    sql.unsafe<UnknownImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE ${predicate}`,
      parameters,
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );

const getBaseById = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapBaseRow(rows[0], operationName, sql),
  );

const getPublicationById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(getBaseById(sql, changeId, "read Change for publication"), (base) =>
    base === undefined
      ? Effect.succeed(undefined)
      : Effect.map(listDecisions(sql, base.id), (implementationDecisions) => ({
          ...base,
          implementationDecisions,
        })),
  );

const readChangeState = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: unknown; readonly state: unknown }>`
      SELECT id, state FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => decodeSelectedChangeState(row, changeId));
  });

const readBlockerResolutionChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "resolve Implementation Blocker";
    const rows = yield* sql<{
      readonly id: unknown;
      readonly state: unknown;
      readonly taskId: unknown;
      readonly acceptanceContext: unknown;
    }>`
      SELECT id, state, task_id AS taskId, acceptance_context AS acceptanceContext
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const selected = decodeSelectedChangeState(row, changeId);
      const taskId = decodeStoredNullableString(row.taskId, "Change Task ID");
      const encodedAcceptanceContext = decodeStoredNullableString(
        row.acceptanceContext,
        "Change Acceptance Context",
      );
      if ((taskId === null) !== (encodedAcceptanceContext === null)) {
        throw new Error("Stored Change Task and Acceptance Context relationship is incomplete");
      }
      return {
        ...selected,
        taskId,
        acceptanceContext:
          encodedAcceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
      };
    });
  });

const readPublicationChange = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<Record<string, unknown>>(
      `SELECT ${publicationSelectionColumns} FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => ({
      ...decodeSelectedChangeState(row, changeId),
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

const requirePublicationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(readPublicationChange(sql, changeId, operationName), (change) =>
    change === undefined
      ? invalidData(operationName, "Change disappeared")
      : Effect.succeed(change),
  );

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

const readCleanupChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const operationName = "record Change cleanup";
    const rows = yield* sql<Record<string, unknown>>`
      SELECT id, state, cleanup_state AS cleanupState,
        cleanup_blocking_reason AS cleanupBlockingReason
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const cleanupState = decodeStoredString(row["cleanupState"], "Change cleanup state");
      if (cleanupState !== "complete" && cleanupState !== "pending") {
        throw new Error("Stored Change cleanup state is unsupported");
      }
      const cleanupBlockingReason = decodeStoredNullableString(
        row["cleanupBlockingReason"],
        "Change cleanup blocking reason",
      );
      if (cleanupState === "complete" && cleanupBlockingReason !== null) {
        throw new Error("Stored completed Change cleanup has a blocking reason");
      }
      const cleanup: ChangeCleanup = {
        state: cleanupState,
        blockingReason: cleanupBlockingReason,
      };
      return { ...decodeSelectedChangeState(row, changeId), cleanup };
    });
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

const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql<UnknownImplementationDecisionRow>`
      SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeId}
    `,
    (rows) =>
      decodePersisted("list Implementation Decisions", () =>
        decodeImplementationDecisions(rows, changeId),
      ),
  );

const readDecisionById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  decisionId: string,
  operationName: string,
) =>
  Effect.flatMap(
    sql<UnknownImplementationDecisionRow>`
      SELECT id, change_id AS changeId, CAST(sequence AS TEXT) AS sequence,
        typeof(sequence) AS sequenceType, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${changeId} AND id = ${decisionId}
    `,
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationDecisions(rows, changeId)[0]),
  );

const recordDecision = (sql: SqlClient.SqlClient, input: RecordImplementationDecisionInput) =>
  Effect.gen(function* () {
    const change = yield* readChangeState(sql, input.changeId, "record Implementation Decision");
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state !== "open") return { ok: false as const, code: "change_not_open" as const };
    const id = randomUUID();
    yield* sql`
      INSERT INTO implementation_decisions (id, change_id, recorded_at, choice, rationale)
      VALUES (${id}, ${input.changeId}, ${input.now}, ${input.choice}, ${input.rationale})
    `;
    const decision = yield* readDecisionById(
      sql,
      input.changeId,
      id,
      "record Implementation Decision",
    );
    if (decision === undefined)
      return yield* invalidData("record Implementation Decision", "Decision disappeared");
    return { ok: true as const, decision };
  });

const getByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE task_id = ?`, [
      taskId,
    ]),
    (rows) => mapTaskRow(rows[0], "read Change by Task", sql),
  );

const getBaseByTaskId = (sql: SqlClient.SqlClient, taskId: string, operationName: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE task_id = ?`, [
      taskId,
    ]),
    (rows) => mapBaseRow(rows[0], operationName, sql),
  );

const getPassingEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  query: CurrentChangeEvidenceQuery | undefined,
  allowHistoricalCandidate: boolean,
) =>
  Effect.gen(function* () {
    const operationName = allowHistoricalCandidate
      ? "read completed Candidate Publication evidence"
      : "read current passing Change evidence";
    const authorityRows = yield* sql<{
      readonly id: unknown;
      readonly state: unknown;
    }>`SELECT id, state FROM changes WHERE id = ${changeId}`;
    const authority = yield* decodePersisted(operationName, () => {
      const row = authorityRows[0];
      if (row === undefined) return undefined;
      const id = decodeStoredString(row.id, "Change ID");
      if (id !== changeId) throw new Error("Change identity does not match evidence lookup");
      if (decodeChangeState(row.state) !== changeState.open) return undefined;
      return { id };
    });
    if (authority === undefined) return undefined;
    const candidatePredicate =
      query?.candidateId === undefined || !allowHistoricalCandidate
        ? `candidate.id = (
             SELECT current.id FROM candidates AS current
             WHERE current.change_id = ?
             ORDER BY current.created_at DESC, current.id DESC LIMIT 1
           )`
        : "candidate.change_id = ? AND candidate.id = ?";
    const runPredicate = query?.validationRunId === undefined ? "1 = 1" : "run.id = ?";
    const parameters = [
      authority.id,
      ...(query?.candidateId === undefined || !allowHistoricalCandidate ? [] : [query.candidateId]),
      ...(query?.validationRunId === undefined ? [] : [query.validationRunId]),
    ];
    const rows = yield* sql.unsafe<PassingPublicationEvidenceRow>(
      `SELECT candidate.id AS publicationCandidateId,
        candidate.change_base_sha AS changeBaseSha, candidate.head_sha AS headSha,
        run.id, run.candidate_id AS candidateId, run.policy_snapshot AS policySnapshot,
        run.implementation_decisions AS implementationDecisions,
        run.latest_resolved_blocker_id AS latestResolvedBlockerId,
        run.state, run.outcome, run.created_at AS createdAt, run.updated_at AS updatedAt
       FROM candidates AS candidate
       JOIN candidate_validation_runs AS run ON run.candidate_id = candidate.id
       WHERE ${candidatePredicate} AND ${runPredicate}
         AND run.state = 'complete' AND run.outcome = 'passed'
       ORDER BY run.created_at DESC, run.id DESC`,
      parameters,
    );
    if (rows.length === 0) return undefined;
    let authorityHistoryLoaded = false;
    let expectedDecisionsSnapshot = "";
    let expectedAcceptanceContext: unknown;
    let currentLatestResolvedBlockerId: string | null | undefined;
    let current: PassingPublicationEvidence | undefined;
    for (const row of rows) {
      const selectedCandidate = yield* decodePersisted(operationName, () => ({
        publicationCandidateId: decodeStoredString(
          row.publicationCandidateId,
          "evidence Candidate ID",
        ),
        changeBaseSha: decodeStoredString(row.changeBaseSha, "Candidate Change Base SHA"),
      }));
      if (
        (query?.candidateId !== undefined &&
          selectedCandidate.publicationCandidateId !== query.candidateId) ||
        (query?.changeBaseSha !== undefined &&
          selectedCandidate.changeBaseSha !== query.changeBaseSha)
      )
        continue;
      if (
        query?.policy !== undefined &&
        !isDeepStrictEqual(
          yield* decodePersisted(operationName, () => decodeValidationRunPolicy(row).policy),
          query.policy,
        )
      )
        continue;
      const run = yield* decodePersisted(operationName, () => decodeValidationRun(row));
      yield* decodePersisted(operationName, () =>
        validateValidationRunImplementationDecisionRelationships(run, authority.id),
      );
      if (run.record.candidateId !== selectedCandidate.publicationCandidateId) continue;
      const evidence: PassingPublicationEvidence = {
        ...selectedCandidate,
        headSha: yield* decodePersisted(operationName, () =>
          decodeStoredString(row.headSha, "Candidate head SHA"),
        ),
        run,
      };
      if (!authorityHistoryLoaded) {
        const acceptanceContextRows = yield* sql<{
          readonly id: unknown;
          readonly taskId: unknown;
          readonly acceptanceContext: unknown;
        }>`SELECT id, task_id AS taskId, acceptance_context AS acceptanceContext
           FROM changes WHERE id = ${authority.id}`;
        expectedAcceptanceContext = yield* decodePersisted(operationName, () => {
          const authorityRow = acceptanceContextRows[0];
          const id = decodeStoredString(authorityRow?.id, "Change ID");
          if (id !== authority.id) throw new Error("Change disappeared during evidence lookup");
          const taskId = decodeStoredNullableString(authorityRow?.taskId, "Change Task ID");
          const encoded = decodeStoredNullableString(
            authorityRow?.acceptanceContext,
            "Change Acceptance Context",
          );
          if ((taskId === null) !== (encoded === null)) {
            throw new Error("Stored Change Task and Acceptance Context relationship is incomplete");
          }
          return encoded === null ? undefined : decodeSqliteAcceptanceContextSnapshot(encoded);
        });
        expectedDecisionsSnapshot = JSON.stringify(yield* listDecisions(sql, authority.id));
        authorityHistoryLoaded = true;
      }
      if (
        evidence.run.implementationDecisionsSnapshot !== expectedDecisionsSnapshot ||
        !isDeepStrictEqual(evidence.run.record.policy.acceptanceContext, expectedAcceptanceContext)
      )
        continue;
      if (currentLatestResolvedBlockerId === undefined) {
        currentLatestResolvedBlockerId = yield* readLatestResolvedBlockerId(
          sql,
          authority.id,
          operationName,
        );
      }
      const latestResolvedBlockerIdAtRun = yield* readLatestResolvedBlockerId(
        sql,
        authority.id,
        operationName,
        evidence.run.record.createdAt,
      );
      yield* decodePersisted(operationName, () =>
        validateValidationRunLatestResolvedBlockerRelationship(
          evidence.run,
          latestResolvedBlockerIdAtRun,
        ),
      );
      if (evidence.run.latestResolvedBlockerId === currentLatestResolvedBlockerId) {
        current = evidence;
        break;
      }
    }
    if (current === undefined) return undefined;
    return {
      candidateId: current.publicationCandidateId,
      validationRunId: current.run.record.id,
      changeBaseSha: current.changeBaseSha,
      headSha: current.headSha,
    } satisfies ChangePublicationEvidence;
  });

const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(
      `SELECT ${changeReadColumns} FROM changes
       WHERE repository_common_directory = ?${input.includeClosed ? "" : " AND state = 'open'"}`,
      [input.repositoryCommonDirectory],
    ),
    (rows) =>
      Effect.map(
        Effect.forEach(rows, (row) => mapRequiredBaseRow(row, "list Changes", sql)),
        (changes) => changes.sort(compareChanges),
      ),
  );

const listForReconciliation = (sql: SqlClient.SqlClient, commonDirectory: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(
      `SELECT ${changeReadColumns} FROM changes
       WHERE repository_common_directory = ?
         AND ((state = 'open' AND publication_pr_number IS NOT NULL)
           OR (state = 'closed' AND cleanup_state = 'pending'))`,
      [commonDirectory],
    ),
    (rows) =>
      Effect.map(
        Effect.forEach(rows, (row) =>
          mapRequiredBaseRow(row, "list Changes for reconciliation", sql),
        ),
        (changes) => changes.sort(compareChanges),
      ),
  );

const compareChanges = (left: ChangeRecord, right: ChangeRecord): number =>
  compareStoredStrings(left.createdAt, right.createdAt) || compareStoredStrings(left.id, right.id);

const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const beginPublication = (sql: SqlClient.SqlClient, input: BeginChangePublicationInput) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(
      yield* readChangeState(sql, input.changeId, "begin Change publication"),
    );
    if (!selected.ok) return selected;
    const change = yield* requirePublicationChange(sql, input.changeId, "begin Change publication");
    if (change.publication !== null) {
      if (!samePendingPublication(change.publication, input)) {
        return { ok: false as const, code: "publication_already_owned" as const };
      }
      return {
        ok: true as const,
        created: false,
        change: yield* requireBaseChange(sql, input.changeId, "begin Change publication"),
      };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = ${input.candidateId}, publication_validation_run_id = ${input.validationRunId}, publication_owner = ${input.target.owner}, publication_repo = ${input.target.repo}, publication_base_branch = ${input.target.baseBranch}, publication_remote_name = ${input.target.remoteName}, publication_head_branch = ${input.headBranch}, publication_expected_head_sha = ${input.expectedHeadSha}, publication_pr_number = NULL, publication_pr_url = NULL, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      created: true,
      change: yield* requireBaseChange(sql, input.changeId, "begin Change publication"),
    };
  });

const replacePendingPublication = (
  sql: SqlClient.SqlClient,
  input: ReplacePendingChangePublicationInput,
) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(
      yield* readChangeState(sql, input.changeId, "replace pending Change publication"),
    );
    if (!selected.ok) return selected;
    const publication = (yield* requirePublicationChange(
      sql,
      input.changeId,
      "replace pending Change publication",
    )).publication;
    if (
      publication === null ||
      publication.pullRequest !== null ||
      publication.candidateId !== input.expectedCurrentCandidateId ||
      publication.validationRunId !== input.expectedCurrentValidationRunId ||
      publication.expectedHeadSha !== input.expectedCurrentHeadSha ||
      publication.headBranch !== input.expectedCurrentHeadBranch ||
      !sameTarget(publication.target, input.expectedCurrentTarget)
    ) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = ${input.candidateId}, publication_validation_run_id = ${input.validationRunId}, publication_owner = ${input.target.owner}, publication_repo = ${input.target.repo}, publication_base_branch = ${input.target.baseBranch}, publication_remote_name = ${input.target.remoteName}, publication_head_branch = ${input.headBranch}, publication_expected_head_sha = ${input.expectedHeadSha}, publication_pr_number = NULL, publication_pr_url = NULL, updated_at = ${input.now} WHERE id = ${input.changeId} AND publication_pr_number IS NULL AND publication_candidate_id = ${input.expectedCurrentCandidateId} AND publication_validation_run_id = ${input.expectedCurrentValidationRunId} AND publication_expected_head_sha = ${input.expectedCurrentHeadSha}`;
    return {
      ok: true as const,
      change: yield* requireBaseChange(sql, input.changeId, "replace pending Change publication"),
    };
  });

const releasePendingPublication = (sql: SqlClient.SqlClient, input: BeginChangePublicationInput) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(
      yield* readChangeState(sql, input.changeId, "release Change publication"),
    );
    if (!selected.ok) return selected;
    const publication = (yield* requirePublicationChange(
      sql,
      input.changeId,
      "release Change publication",
    )).publication;
    if (publication === null) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    if (!samePendingPublication(publication, input)) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = NULL, publication_validation_run_id = NULL, publication_owner = NULL, publication_repo = NULL, publication_base_branch = NULL, publication_remote_name = NULL, publication_head_branch = NULL, publication_expected_head_sha = NULL, publication_pr_number = NULL, publication_pr_url = NULL, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      change: yield* requireBaseChange(sql, input.changeId, "release Change publication"),
    };
  });

const recordPublishedPullRequest = (
  sql: SqlClient.SqlClient,
  input: RecordPublishedPullRequestInput,
) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(
      yield* readChangeState(sql, input.changeId, "record Change publication"),
    );
    if (!selected.ok) return selected;
    const change = yield* requirePublicationChange(
      sql,
      input.changeId,
      "record Change publication",
    );
    if (!canRecordPublication(change.publication, input)) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = ${input.candidateId}, publication_validation_run_id = ${input.validationRunId}, publication_expected_head_sha = ${input.expectedHeadSha}, publication_pr_number = ${input.pullRequest.number}, publication_pr_url = ${input.pullRequest.url}, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      change: yield* requireBaseChange(sql, input.changeId, "record Change publication"),
    };
  });

const completeMergedChange = (sql: SqlClient.SqlClient, input: CompleteMergedChangeInput) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, "complete merged Change");
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "completed") {
        return { ok: false as const, code: "change_already_closed" as const };
      }
      return {
        ok: true as const,
        changed: false,
        change: yield* requireBaseChange(sql, input.changeId, "complete merged Change"),
      };
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
    return {
      ok: true as const,
      changed: true,
      change: yield* requireBaseChange(sql, input.changeId, "complete merged Change"),
    };
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
      return {
        ok: true as const,
        changed: false,
        change: yield* requireBaseChange(sql, input.changeId, "cancel Change"),
      };
    }
    const change = yield* readCancelChange(sql, input.changeId);
    if (change === undefined) return yield* invalidData("cancel Change", "Change disappeared");
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'cancelled', cancel_reason = ${change.taskId === null ? input.reason : null}, cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'cancelled', cancel_reason = ${input.reason}, updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return {
      ok: true as const,
      changed: true,
      change: yield* requireBaseChange(sql, input.changeId, "cancel Change"),
    };
  });

const recordCleanup = (sql: SqlClient.SqlClient, input: RecordChangeCleanupInput) =>
  Effect.gen(function* () {
    const selected = yield* readChangeState(sql, input.changeId, "record Change cleanup");
    if (selected === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (selected.state !== changeState.closed)
      return { ok: false as const, code: "change_not_closed" as const };
    const change = yield* readCleanupChange(sql, input.changeId);
    if (change === undefined)
      return yield* invalidData("record Change cleanup", "Change disappeared");
    const changed = cleanupChanged(change.cleanup, input.cleanup);
    if (changed) {
      yield* sql`UPDATE changes SET cleanup_state = ${input.cleanup.state}, cleanup_blocking_reason = ${input.cleanup.blockingReason}, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    }
    return {
      ok: true as const,
      changed,
      change: yield* requireBaseChange(sql, input.changeId, "record Change cleanup"),
    };
  });

const requireBaseChange = (sql: SqlClient.SqlClient, id: string, operationName: string) =>
  Effect.flatMap(getBaseById(sql, id, operationName), (change) =>
    change === undefined
      ? invalidData(operationName, "Change disappeared")
      : Effect.succeed(change),
  );

const selectOpenChange = <A extends { readonly state: ChangeRecord["state"] }>(
  change: A | undefined,
):
  | { readonly ok: true; readonly change: A }
  | {
      readonly ok: false;
      readonly code: "change_not_found" | "change_closed";
    } => {
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
      input.previousPullRequestNumber === input.pullRequest.number &&
      publication.expectedHeadSha === input.previousExpectedHeadSha &&
      publication.candidateId === input.previousCandidateId &&
      publication.validationRunId === input.previousValidationRunId &&
      (publication.pullRequest === null ||
        publication.pullRequest.number === input.previousPullRequestNumber);

const sameTarget = (
  left: ChangePublication["target"],
  right: ChangePublication["target"],
): boolean =>
  left.owner === right.owner &&
  left.repo === right.repo &&
  left.baseBranch === right.baseBranch &&
  left.remoteName === right.remoteName;

const mapRequiredBaseRow = (
  row: UnknownChangeRow,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  Effect.flatMap(mapBaseRow(row, operationName, sql), (change) =>
    change === undefined
      ? invalidData(operationName, "Change row disappeared")
      : Effect.succeed(change),
  );

const mapRow = (
  row: UnknownChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  Effect.flatMap(mapBaseRow(row, operationName, sql), (base) =>
    base === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const decisions = yield* listDecisions(sql, base.id);
          const activeBlocker = yield* readActiveBlocker(sql, base.id, operationName);
          return {
            ...base,
            implementationDecisions: decisions,
            activeBlocker,
          } satisfies ChangeRecord;
        }),
  );

const mapTaskRow = (
  row: UnknownChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  Effect.flatMap(mapBaseRow(row, operationName, sql), (base) =>
    base === undefined
      ? Effect.succeed(undefined)
      : Effect.map(readActiveBlocker(sql, base.id, operationName), (activeBlocker) => ({
          ...base,
          activeBlocker,
        })),
  );

const mapBaseRow = (
  row: UnknownChangeRow | undefined,
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

type PassingPublicationEvidenceRow = UnknownValidationRunRow & {
  readonly publicationCandidateId: unknown;
  readonly changeBaseSha: unknown;
  readonly headSha: unknown;
};

type PassingPublicationEvidence = {
  readonly publicationCandidateId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly run: ReturnType<typeof decodeValidationRun>;
};
