import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";

import {
  changeState,
  type ChangeCleanup,
  type ChangePublication,
  type ChangeRecord,
} from "../change/change.js";
import type {
  ChangePersistence,
  ChangePublicationEvidence,
  CurrentPublicationAuthority,
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
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { storedPublicTaskId } from "../task/taskId.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import type { ReviewerSessionRecord } from "../change/reviewerSession/reviewerSession.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "../change/implementationBlocker.js";
import type { RecordImplementationDecisionInput } from "../change/changePersistence.js";

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
    raiseImplementationBlocker: (input) =>
      repository.transactionImmediate("raise Implementation Blocker", (sql) =>
        raiseBlocker(sql, input),
      ),
    resolveImplementationBlocker: (input) =>
      repository.transactionImmediate("resolve Implementation Blocker", (sql) =>
        resolveBlocker(sql, input),
      ),
    listImplementationBlockers: (changeId) =>
      repository.operation("list Implementation Blockers", (sql) => listBlockers(sql, changeId)),
    getChangeById: (changeId) =>
      repository.transaction("read Change", (sql) => getById(sql, changeId)),
    getChangeByTaskId: (taskId) =>
      repository.transaction("read Change by Task", (sql) => getByTaskId(sql, taskId)),
    listImplementationDecisions: (changeId) =>
      repository.operation("list Implementation Decisions", (sql) => listDecisions(sql, changeId)),
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
      repository.operation("read Reviewer Session", (sql) =>
        Effect.flatMap(
          sql<ReviewerSessionRow>`SELECT identity, fingerprint, session_reference AS sessionReference, last_candidate_id AS lastCandidateId FROM reviewer_sessions WHERE change_id = ${changeId} AND producer = ${producer}`,
          (rows) => {
            const row = rows[0];
            if (row === undefined) return Effect.succeed(undefined);
            return Effect.sync(() => {
              try {
                return {
                  identity: JSON.parse(row.identity),
                  fingerprint: row.fingerprint,
                  sessionReference: row.sessionReference,
                  lastCandidateId: row.lastCandidateId,
                } as ReviewerSessionRecord;
              } catch {
                return {
                  identity: {} as ReviewerSessionRecord["identity"],
                  fingerprint: "",
                  sessionReference: "",
                  lastCandidateId: "",
                };
              }
            });
          },
        ),
      ),
    saveReviewerSession: (input) =>
      repository.transactionImmediate("save Reviewer Session", (sql) =>
        Effect.asVoid(sql`
      INSERT INTO reviewer_sessions (change_id, producer, identity, fingerprint, session_reference, last_candidate_id, updated_at)
      VALUES (${input.identity.changeId}, ${input.identity.producer}, ${JSON.stringify(input.identity)}, ${input.fingerprint}, ${input.sessionReference}, ${input.lastCandidateId}, datetime('now'))
      ON CONFLICT(change_id, producer) DO UPDATE SET identity = excluded.identity, fingerprint = excluded.fingerprint, session_reference = excluded.session_reference, last_candidate_id = excluded.last_candidate_id, updated_at = excluded.updated_at
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
    const activeRows =
      yield* sql<ImplementationBlockerRow>`SELECT sequence, id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt FROM implementation_blockers WHERE change_id = ${input.changeId} AND resolved_at IS NULL LIMIT 1`;
    if (activeRows.length > 0) return { ok: false as const, code: "change_blocked" as const };
    const id = randomUUID();
    yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content) VALUES (${id}, ${input.changeId}, ${input.now}, ${input.content})`;
    const updated = yield* requireChange(sql, input.changeId, "raise Implementation Blocker");
    const rows =
      yield* sql<ImplementationBlockerRow>`SELECT sequence, id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt FROM implementation_blockers WHERE id = ${id}`;
    const stored = rows[0];
    if (stored === undefined)
      return yield* invalidData("raise Implementation Blocker", "Blocker disappeared");
    return { ok: true as const, change: updated, blocker: mapBlocker(stored) };
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
    const rows =
      yield* sql<ImplementationBlockerRow>`SELECT sequence, id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt FROM implementation_blockers WHERE change_id = ${input.changeId} AND resolved_at IS NULL LIMIT 1`;
    const blocker = rows[0];
    if (blocker === undefined) return { ok: false as const, code: "no_active_blocker" as const };
    const resolutionId = randomUUID();
    yield* sql`UPDATE implementation_blockers SET resolved_at = ${input.now}, resolution_id = ${resolutionId}, resolution_recorded_at = ${input.now}, resolution_content = ${input.content} WHERE id = ${blocker.id}`;
    if (change.taskId !== null && change.acceptanceContext !== null) {
      yield* sql`UPDATE changes SET acceptance_context = json_set(acceptance_context, '$.resolutions', json_insert(COALESCE(json_extract(acceptance_context, '$.resolutions'), '[]'), '$[#]', ${input.content})), updated_at = ${input.now} WHERE id = ${input.changeId}`;
    }
    const updated = yield* requireChange(sql, input.changeId, "resolve Implementation Blocker");
    return {
      ok: true as const,
      change: updated,
      blocker: {
        ...mapBlocker(blocker),
        resolvedAt: input.now,
        resolution: {
          id: resolutionId,
          blockerId: blocker.id,
          recordedAt: input.now,
          content: input.content,
        },
      },
    };
  });

const listBlockers = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const exists = yield* sql`SELECT id FROM changes WHERE id = ${changeId}`;
    if (exists.length === 0) return undefined;
    const rows = yield* sql<
      ImplementationBlockerRow & {
        readonly resolutionId: string | null;
        readonly resolutionRecordedAt: string | null;
        readonly resolutionContent: string | null;
      }
    >`SELECT sequence, id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt, resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt, resolution_content AS resolutionContent FROM implementation_blockers WHERE change_id = ${changeId} ORDER BY sequence`;
    const blockers = rows.map((row) => {
      if (
        row.resolutionId === null ||
        row.resolutionRecordedAt === null ||
        row.resolutionContent === null
      ) {
        return { ...mapBlocker(row), resolution: null };
      }
      return {
        ...mapBlocker(row),
        resolution: {
          id: row.resolutionId,
          blockerId: row.id,
          recordedAt: row.resolutionRecordedAt,
          content: row.resolutionContent,
        },
      };
    });
    return {
      blockers,
      resolutions: blockers.flatMap((blocker) =>
        blocker.resolution === null ? [] : [blocker.resolution],
      ),
      active: blockers.find((blocker) => blocker.resolvedAt === null) ?? null,
    } satisfies ImplementationBlockerHistory;
  });

const mapBlocker = (row: ImplementationBlockerRow): ImplementationBlocker => ({
  id: row.id,
  changeId: row.changeId,
  sequence: Number(row.sequence),
  reportedAt: row.reportedAt,
  content: row.content,
  resolvedAt: row.resolvedAt,
  resolution: null,
});

type ImplementationBlockerRow = {
  readonly sequence: number | bigint;
  readonly id: string;
  readonly changeId: string;
  readonly reportedAt: string;
  readonly content: string;
  readonly resolvedAt: string | null;
};

const getById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(`SELECT ${columns} FROM changes WHERE id = ?`, [changeId]),
    (rows) => mapRow(rows[0], "read Change", sql),
  );

const listDecisions = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.map(
    sql<{
      readonly id: string;
      readonly changeId: string;
      readonly sequence: number | bigint;
      readonly recordedAt: string;
      readonly choice: string;
      readonly rationale: string;
    }>`
      SELECT id, change_id AS changeId, sequence, recorded_at AS recordedAt, choice, rationale
      FROM implementation_decisions WHERE change_id = ${changeId}
      ORDER BY sequence ASC
    `,
    (rows) =>
      rows.map(
        (row): ImplementationDecision => ({
          id: row.id,
          changeId: row.changeId,
          sequence: Number(row.sequence),
          recordedAt: row.recordedAt,
          choice: row.choice,
          rationale: row.rationale,
        }),
      ),
  );

const recordDecision = (sql: SqlClient.SqlClient, input: RecordImplementationDecisionInput) =>
  Effect.gen(function* () {
    const changes = yield* sql<{
      readonly state: string;
    }>`
      SELECT state FROM changes WHERE id = ${input.changeId}
    `;
    const change = changes[0];
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
    sql.unsafe<ChangeRow>(`SELECT ${columns} FROM changes WHERE task_id = ?`, [taskId]),
    (rows) => mapRow(rows[0], "read Change by Task", sql),
  );

const getPassingPublicationEvidence = (
  sql: SqlClient.SqlClient,
  changeId: string,
  authority: CurrentPublicationAuthority,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<PassingPublicationEvidenceRow>`
      SELECT
        candidate.id AS candidateId,
        run.id AS validationRunId,
        candidate.change_base_sha AS changeBaseSha,
        candidate.head_sha AS headSha,
        run.policy_snapshot AS policySnapshot,
        run.implementation_decisions AS implementationDecisions
      FROM changes AS change
      JOIN candidates AS candidate
        ON candidate.id = change.publication_candidate_id
        AND candidate.change_id = change.id
      JOIN candidate_validation_runs AS run
        ON run.id = change.publication_validation_run_id
        AND run.candidate_id = candidate.id
      WHERE change.id = ${changeId}
        AND change.publication_pr_number IS NOT NULL
        AND run.state = 'complete'
        AND run.outcome = 'passed'
        AND candidate.change_base_sha = ${authority.changeBaseSha}
        AND (
          (run.latest_resolved_blocker_id IS NULL AND NOT EXISTS (
            SELECT 1
            FROM implementation_blockers AS blocker
            WHERE blocker.change_id = change.id
              AND blocker.resolved_at IS NOT NULL
          ))
          OR run.latest_resolved_blocker_id = (
            SELECT blocker.id
            FROM implementation_blockers AS blocker
            WHERE blocker.change_id = change.id
              AND blocker.resolved_at IS NOT NULL
            ORDER BY blocker.resolved_at DESC, blocker.sequence DESC
            LIMIT 1
          )
        )
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const expectedPolicySnapshot = encodeSqliteCandidateValidationPolicy(authority.policy);
    const expectedDecisionsSnapshot = JSON.stringify(authority.implementationDecisions ?? []);
    if (
      row.policySnapshot !== expectedPolicySnapshot ||
      row.implementationDecisions !== expectedDecisionsSnapshot
    ) {
      return undefined;
    }
    return {
      candidateId: row.candidateId,
      validationRunId: row.validationRunId,
      changeBaseSha: row.changeBaseSha,
      headSha: row.headSha,
    } satisfies ChangePublicationEvidence;
  });

const listChanges = (sql: SqlClient.SqlClient, input: ListChangesInput) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(
      `SELECT ${columns} FROM changes WHERE repository_common_directory = ? AND (? = 1 OR state IN ('open', 'blocked')) ORDER BY created_at ASC, id ASC`,
      [input.repositoryCommonDirectory, input.includeClosed ? 1 : 0],
    ),
    (rows) => Effect.forEach(rows, (row) => mapRequiredRow(row, "list Changes", sql)),
  );

const listForReconciliation = (sql: SqlClient.SqlClient, commonDirectory: string) =>
  Effect.flatMap(
    sql.unsafe<ChangeRow>(
      `SELECT ${columns} FROM changes WHERE repository_common_directory = ? AND ((state = 'open' AND publication_pr_number IS NOT NULL) OR (state = 'closed' AND cleanup_state = 'pending')) ORDER BY created_at ASC, id ASC`,
      [commonDirectory],
    ),
    (rows) =>
      Effect.forEach(rows, (row) => mapRequiredRow(row, "list Changes for reconciliation", sql)),
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
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'completed', cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'done', updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return {
      ok: true as const,
      changed: true,
      change: yield* requireChange(sql, input.changeId, "complete merged Change"),
    };
  });

const cancelChange = (sql: SqlClient.SqlClient, input: CancelChangeInput) =>
  Effect.gen(function* () {
    const change = yield* getById(sql, input.changeId);
    if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (change.state === changeState.closed) {
      return change.closeReason === "cancelled"
        ? { ok: true as const, changed: false, change }
        : { ok: false as const, code: "change_already_completed" as const };
    }
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'cancelled', cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state IN ('open', 'blocked')`;
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
  return change.state === changeState.closed || change.state === changeState.blocked
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

const mapRequiredRow = (row: ChangeRow, operationName: string, sql: SqlClient.SqlClient) =>
  Effect.flatMap(mapRow(row, operationName, sql), (change) =>
    change === undefined
      ? invalidData(operationName, "Change row disappeared")
      : Effect.succeed(change),
  );
const mapRow = (row: ChangeRow | undefined, operationName: string, sql: SqlClient.SqlClient) =>
  row === undefined
    ? Effect.succeed(undefined)
    : Effect.gen(function* () {
        const decisions = yield* listDecisions(sql, row.id);
        const activeRows =
          yield* sql<ImplementationBlockerRow>`SELECT sequence, id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt FROM implementation_blockers WHERE change_id = ${row.id} AND resolved_at IS NULL LIMIT 1`;
        return yield* Effect.try({
          try: (): ChangeRecord => ({
            id: row.id,
            repositoryCommonDirectory: row.repositoryCommonDirectory,
            branchRef: row.branchRef,
            baseRef: row.baseRef,
            baseRemoteUrl: row.baseRemoteUrl,
            taskId: row.taskId === null ? null : storedPublicTaskId(row.taskId),
            startingCommit: row.startingCommit,
            worktreePath: row.worktreePath,
            acceptanceContext:
              row.acceptanceContext === null
                ? null
                : decodeSqliteAcceptanceContextSnapshot(row.acceptanceContext),
            implementationDecisions: decisions,
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
            activeBlocker: activeRows[0] === undefined ? null : mapBlocker(activeRows[0]),
            closeReason: row.closeReason,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            closedAt: row.closedAt,
          }),
          catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
        });
      });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type ReviewerSessionRow = {
  readonly identity: string;
  readonly fingerprint: string;
  readonly sessionReference: string;
  readonly lastCandidateId: string;
};

type PassingPublicationEvidenceRow = ChangePublicationEvidence & {
  readonly policySnapshot: string;
  readonly implementationDecisions: string;
};

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
