import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import {
  type ChangeCleanup,
  type ChangePublication,
  type ChangeRecord,
  changeState,
} from "../change/change.js";
import type {
  ChangePersistence,
  ChangePublicationEvidence,
  CurrentPublicationAuthority,
  RecordImplementationDecisionInput,
} from "../change/changePersistence.js";
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
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  changeReadColumns,
  decodeChangeRow,
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  decodeReviewerSession,
  decodeReviewerTranscript,
  implementationBlockerReadColumns,
  latestResolvedBlockerId,
  type UnknownChangeRow,
  type UnknownImplementationBlockerRow,
  type UnknownImplementationDecisionRow,
  validateChangeRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteTaskReadModel.js";

export const openSqliteChangePersistence = (): Effect.Effect<
  ChangePersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
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
      repository.transaction("list Implementation Decisions", (sql) =>
        listDecisions(sql, changeId),
      ),
    recordImplementationDecision: (input) =>
      repository.transactionImmediate("record Implementation Decision", (sql) =>
        recordDecision(sql, input),
      ),
    getPassingPublicationEvidence: (changeId, authority) =>
      repository.transaction("read passing Change publication evidence", (sql) =>
        getPassingPublicationEvidence(sql, changeId, authority),
      ),
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
              : decodePersisted("read Reviewer Session", () =>
                  decodeReviewerSession(row, changeId),
                );
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
  }));

const raiseBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed)
      return { ok: false as const, code: "change_not_open" as const };
    const history = yield* readBlockers(sql, input.changeId, "raise Implementation Blocker");
    if (history.active !== null) return { ok: false as const, code: "change_blocked" as const };
    const id = randomUUID();
    yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content) VALUES (${id}, ${input.changeId}, ${input.now}, ${input.content})`;
    const updated = yield* requireChange(sql, input.changeId, "raise Implementation Blocker");
    const recorded = yield* readBlockers(sql, input.changeId, "raise Implementation Blocker");
    const stored = recorded.blockers.find((blocker) => blocker.id === id);
    if (stored === undefined)
      return yield* invalidData("raise Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, change: updated, blocker: stored };
  });

const resolveBlocker = (
  sql: SqlClient.SqlClient,
  input: { readonly changeId: string; readonly content: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed)
      return { ok: false as const, code: "no_active_blocker" as const };
    const history = yield* readBlockers(sql, input.changeId, "resolve Implementation Blocker");
    const blocker = history.active;
    if (blocker === null) return { ok: false as const, code: "no_active_blocker" as const };
    const resolutionId = randomUUID();
    yield* sql`UPDATE implementation_blockers SET resolved_at = ${input.now}, resolution_id = ${resolutionId}, resolution_recorded_at = ${input.now}, resolution_content = ${input.content} WHERE id = ${blocker.id}`;
    if (change.taskId !== null && change.acceptanceContext !== null) {
      yield* sql`UPDATE changes SET acceptance_context = json_set(acceptance_context, '$.resolutions', json_insert(COALESCE(json_extract(acceptance_context, '$.resolutions'), '[]'), '$[#]', ${input.content})), updated_at = ${input.now} WHERE id = ${input.changeId}`;
    }
    const updated = yield* requireChange(sql, input.changeId, "resolve Implementation Blocker");
    const recorded = yield* readBlockers(sql, input.changeId, "resolve Implementation Blocker");
    const resolved = recorded.blockers.find((item) => item.id === blocker.id);
    if (resolved === undefined)
      return yield* invalidData("resolve Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, change: updated, blocker: resolved };
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

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE id = ?`, [
      changeId,
    ]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );

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

const recordDecision = (sql: SqlClient.SqlClient, input: RecordImplementationDecisionInput) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state !== "open") return { ok: false as const, code: "change_not_open" as const };
    const id = randomUUID();
    yield* sql`
      INSERT INTO implementation_decisions (id, change_id, recorded_at, choice, rationale)
      VALUES (${id}, ${input.changeId}, ${input.now}, ${input.choice}, ${input.rationale})
    `;
    const decisions = yield* listDecisions(sql, input.changeId);
    const decision = decisions.find((item) => item.id === id);
    if (decision === undefined)
      return yield* invalidData("record Implementation Decision", "Decision disappeared");
    return { ok: true as const, decision };
  });

const getByTaskId = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(`SELECT ${changeReadColumns} FROM changes WHERE task_id = ?`, [
      taskId,
    ]),
    (rows) => mapRow(rows[0], "read Change by Task", sql),
  );

const getPassingPublicationEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  authority: CurrentPublicationAuthority,
) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, changeId);
    if (change === undefined || change.publication === null) return undefined;
    if (change.publication.pullRequest === null) return undefined;
    const rows = yield* sql<PassingPublicationEvidenceRow>`
      SELECT candidate.id AS candidateId, run.id AS validationRunId,
        candidate.change_base_sha AS changeBaseSha, candidate.head_sha AS headSha,
        run.policy_snapshot AS policySnapshot,
        run.implementation_decisions AS implementationDecisions,
        run.state, run.outcome, run.latest_resolved_blocker_id AS latestResolvedBlockerId
      FROM candidates AS candidate
      JOIN candidate_validation_runs AS run ON run.id = ${change.publication.validationRunId}
      WHERE candidate.id = ${change.publication.candidateId}
    `;
    const row = rows[0];
    if (row === undefined) {
      return yield* invalidData(
        "get passing publication evidence",
        "Publication identity disappeared",
      );
    }
    const decoded = yield* decodePersisted("get passing publication evidence", () => {
      const state = decodeStoredString(row.state, "Validation Run state");
      const outcome = decodeStoredNullableString(row.outcome, "Validation Run outcome");
      if (state !== "running" && state !== "complete") {
        throw new Error("Stored Validation Run state is unsupported");
      }
      if (
        outcome !== null &&
        outcome !== "passed" &&
        outcome !== "blocked" &&
        outcome !== "tooling_failed"
      ) {
        throw new Error("Stored Validation Run outcome is unsupported");
      }
      if ((state === "running" && outcome !== null) || (state === "complete" && outcome === null)) {
        throw new Error("Stored Validation Run lifecycle relationship is inconsistent");
      }
      return {
        candidateId: decodeStoredString(row.candidateId, "publication Candidate ID"),
        validationRunId: decodeStoredString(row.validationRunId, "publication Validation Run ID"),
        changeBaseSha: decodeStoredString(row.changeBaseSha, "Candidate Change Base SHA"),
        headSha: decodeStoredString(row.headSha, "Candidate head SHA"),
        policySnapshot: decodeStoredString(row.policySnapshot, "Validation Policy Snapshot"),
        implementationDecisions: decodeStoredString(
          row.implementationDecisions,
          "Implementation Decision Snapshot",
        ),
        state,
        outcome,
        latestResolvedBlockerId: decodeStoredNullableString(
          row.latestResolvedBlockerId,
          "Validation Run latest resolved Blocker ID",
        ),
      };
    });
    const blockerHistory = yield* readBlockers(sql, change.id, "get passing publication evidence");
    if (
      decoded.latestResolvedBlockerId !== null &&
      !blockerHistory.blockers.some(
        (blocker) => blocker.id === decoded.latestResolvedBlockerId && blocker.resolution !== null,
      )
    ) {
      return yield* invalidData(
        "get passing publication evidence",
        "Validation Run latest resolved Blocker belongs to another Change",
      );
    }
    if (
      decoded.state !== "complete" ||
      decoded.outcome !== "passed" ||
      decoded.changeBaseSha !== authority.changeBaseSha ||
      decoded.latestResolvedBlockerId !== latestResolvedBlockerId(blockerHistory)
    ) {
      return undefined;
    }
    const expectedPolicySnapshot = yield* Effect.try({
      try: () => encodeSqliteCandidateValidationPolicy(authority.policy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "get passing publication evidence",
          cause,
        }),
    });
    const expectedDecisionsSnapshot = JSON.stringify(authority.implementationDecisions ?? []);
    if (
      decoded.policySnapshot !== expectedPolicySnapshot ||
      decoded.implementationDecisions !== expectedDecisionsSnapshot
    ) {
      return undefined;
    }
    return {
      candidateId: decoded.candidateId,
      validationRunId: decoded.validationRunId,
      changeBaseSha: decoded.changeBaseSha,
      headSha: decoded.headSha,
    } satisfies ChangePublicationEvidence;
  });

const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(
      `SELECT ${changeReadColumns} FROM changes WHERE repository_common_directory = ?`,
      [input.repositoryCommonDirectory],
    ),
    (rows) =>
      Effect.map(
        Effect.forEach(rows, (row) => mapRequiredRow(row, "list Changes", sql)),
        (changes) =>
          changes
            .filter((change) => input.includeClosed || change.state === changeState.open)
            .sort(compareChanges),
      ),
  );

const listForReconciliation = (sql: SqlClient.SqlClient, commonDirectory: string) =>
  Effect.flatMap(
    sql.unsafe<UnknownChangeRow>(
      `SELECT ${changeReadColumns} FROM changes WHERE repository_common_directory = ?`,
      [commonDirectory],
    ),
    (rows) =>
      Effect.map(
        Effect.forEach(rows, (row) => mapRequiredRow(row, "list Changes for reconciliation", sql)),
        (changes) =>
          changes
            .filter(
              (change) =>
                (change.state === changeState.open &&
                  change.publication !== null &&
                  change.publication.pullRequest !== null) ||
                (change.state === changeState.closed && change.cleanup.state === "pending"),
            )
            .sort(compareChanges),
      ),
  );

const compareChanges = (left: ChangeRecord, right: ChangeRecord): number =>
  compareStoredStrings(left.createdAt, right.createdAt) || compareStoredStrings(left.id, right.id);

const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

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

const replacePendingPublication = (
  sql: SqlClient.SqlClient,
  input: ReplacePendingChangePublicationInput,
) =>
  Effect.gen(function* () {
    const selected = selectOpenChange(yield* getById(sql, input.changeId));
    if (!selected.ok) return selected;
    const publication = selected.change.publication;
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
      change: yield* requireChange(sql, input.changeId, "replace pending Change publication"),
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
    if (!matchesExactMergedEvidence(change, input.observed)) {
      return { ok: false as const, code: "publication_mismatch" as const };
    }
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'completed', cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'done', updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return {
      ok: true as const,
      changed: true,
      change: yield* requireChange(sql, input.changeId, "complete merged Change"),
    };
  });

const matchesExactMergedEvidence = (
  change: ChangeRecord,
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
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed) {
      return change.closeReason === "cancelled"
        ? { ok: true as const, changed: false, change }
        : { ok: false as const, code: "change_already_completed" as const };
    }
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'cancelled', cancel_reason = ${change.taskId === null ? input.reason : null}, cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'cancelled', cancel_reason = ${input.reason}, updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return {
      ok: true as const,
      changed: true,
      change: yield* requireChange(sql, input.changeId, "cancel Change"),
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

const mapRequiredRow = (row: UnknownChangeRow, operationName: string, sql: SqlClient.SqlClient) =>
  Effect.flatMap(mapRow(row, operationName, sql), (change) =>
    change === undefined
      ? invalidData(operationName, "Change row disappeared")
      : Effect.succeed(change),
  );

const mapRow = (
  row: UnknownChangeRow | undefined,
  operationName: string,
  sql: SqlClient.SqlClient,
) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.gen(function* () {
        const base = yield* decodePersisted(operationName, () => decodeChangeRow(row));
        const decisions = yield* listDecisions(sql, base.id);
        const blockers = yield* readBlockers(sql, base.id, operationName);
        const change: ChangeRecord = {
          ...base,
          implementationDecisions: decisions,
          activeBlocker: blockers.active,
        };
        yield* validateChangeRelationships(sql, change, operationName);
        return change;
      });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type PassingPublicationEvidenceRow = {
  readonly candidateId: unknown;
  readonly validationRunId: unknown;
  readonly changeBaseSha: unknown;
  readonly headSha: unknown;
  readonly policySnapshot: unknown;
  readonly implementationDecisions: unknown;
  readonly state: unknown;
  readonly outcome: unknown;
  readonly latestResolvedBlockerId: unknown;
};
