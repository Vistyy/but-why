import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangePublication, ChangeRecord } from "../change/change.js";
import { internalChangeId } from "../change/changeId.js";
import type {
  CandidatePublicationChange,
  CandidatePublicationPort,
  PendingCandidatePublicationChange,
  PublishedCandidatePublicationChange,
} from "../change/changePorts.js";
import type {
  BeginChangePublicationInput,
  RecordPublishedPullRequestInput,
  ReplacePendingChangePublicationInput,
} from "../change/changeStore.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  changeReadColumns,
  decodeChangeRow,
  decodeImplementationDecisions,
  type StoredChangeRow,
  type StoredImplementationDecisionRow,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import { readCurrentPassingValidationEvidence } from "./sqlitePassingValidationEvidence.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteCandidatePublicationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): CandidatePublicationPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for publication", (sql) =>
          getPublicationById(sql, changeId, repository.idPrefix),
        ),
      getCurrentPassingEvidence: (changeId, query) =>
        repository.transaction("read current passing Change evidence", (sql) =>
          readCurrentPassingValidationEvidence(sql, changeId, query, repository.idPrefix),
        ),
      beginPublication: (input) =>
        repository.transactionImmediate("begin Change publication", (sql) =>
          beginPublication(sql, input, repository.idPrefix),
        ),
      replacePendingPublication: (input) =>
        repository.transactionImmediate("replace pending Change publication", (sql) =>
          replacePendingPublication(sql, input, repository.idPrefix),
        ),
      releasePendingPublication: (input) =>
        repository.transactionImmediate("release Change publication", (sql) =>
          releasePendingPublication(sql, input, repository.idPrefix),
        ),
      recordPublishedPullRequest: (input) =>
        repository.transactionImmediate("record Change publication", (sql) =>
          recordPublishedPullRequest(sql, input, repository.idPrefix),
        ),
    }),
  );

const getPublicationById = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.map(readFullChange(sql, changeId, idPrefix), (change) =>
    change === undefined ? undefined : candidatePublicationChange(change),
  );

const candidatePublicationChange = (change: ChangeRecord): CandidatePublicationChange => ({
  id: change.id,
  state: change.state,
  branchRef: change.branchRef,
  acceptanceContext: change.acceptanceContext,
  implementationDecisions: change.state === "open" ? change.implementationDecisions : [],
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
    const selected = yield* decodePersisted("read Change for publication", () =>
      decodeChangeRow(row, idPrefix),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      "read Change for publication",
      idPrefix,
    );
    const decisions = yield* listDecisions(sql, selected.id, idPrefix);
    return {
      ...selected,
      implementationDecisions: decisions,
      activeBlocker: null,
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

const beginPublication = (
  sql: SqlClient.SqlClient,
  input: BeginChangePublicationInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* getPublicationById(sql, input.changeId, idPrefix);
    const selected = selectOpenChange(change);
    if (!selected.ok) return selected;
    if (selected.change.publication !== null) {
      if (!samePendingPublication(selected.change.publication, input)) {
        return { ok: false as const, code: "publication_already_owned" as const };
      }
      return {
        ok: true as const,
        created: false,
        change: requirePending(selected.change),
      };
    }
    yield* sql`
      INSERT INTO github_publications (
        change_id, candidate_id, validation_run_id, pull_request_number
      ) VALUES (
        ${internalChangeId(input.changeId, idPrefix)}, ${input.candidateId},
        ${input.validationRunId}, NULL
      )
    `;
    const stored = yield* requirePublicationChange(sql, input.changeId, idPrefix);
    if (stored.publication === null || !samePendingPublication(stored.publication, input)) {
      return yield* invalidData(
        "begin Change publication",
        "Publication binding does not match the Change",
      );
    }
    return { ok: true as const, created: true, change: requirePending(stored) };
  });

const replacePendingPublication = (
  sql: SqlClient.SqlClient,
  input: ReplacePendingChangePublicationInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* getPublicationById(sql, input.changeId, idPrefix);
    const selected = selectOpenChange(change);
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
    yield* sql`
      UPDATE github_publications
      SET candidate_id = ${input.candidateId}, validation_run_id = ${input.validationRunId}
      WHERE change_id = ${internalChangeId(input.changeId, idPrefix)}
        AND pull_request_number IS NULL
        AND candidate_id = ${input.expectedCurrentCandidateId}
        AND validation_run_id = ${input.expectedCurrentValidationRunId}
    `;
    const stored = yield* requirePublicationChange(sql, input.changeId, idPrefix);
    if (stored.publication === null || !samePendingPublication(stored.publication, input)) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    return { ok: true as const, change: requirePending(stored) };
  });

const releasePendingPublication = (
  sql: SqlClient.SqlClient,
  input: BeginChangePublicationInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* getPublicationById(sql, input.changeId, idPrefix);
    const selected = selectOpenChange(change);
    if (!selected.ok) return selected;
    if (
      selected.change.publication === null ||
      !samePendingPublication(selected.change.publication, input)
    ) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`
      DELETE FROM github_publications
      WHERE change_id = ${internalChangeId(input.changeId, idPrefix)}
        AND candidate_id = ${input.candidateId}
        AND validation_run_id = ${input.validationRunId}
        AND pull_request_number IS NULL
    `;
    const stored = yield* requirePublicationChange(sql, input.changeId, idPrefix);
    return stored.publication === null
      ? { ok: true as const, publication: null }
      : { ok: false as const, code: "publication_state_conflict" as const };
  });

const recordPublishedPullRequest = (
  sql: SqlClient.SqlClient,
  input: RecordPublishedPullRequestInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const change = yield* getPublicationById(sql, input.changeId, idPrefix);
    const selected = selectOpenChange(change);
    if (!selected.ok) return selected;
    if (!canRecordPublication(selected.change.publication, input)) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    yield* sql`
      UPDATE github_publications
      SET candidate_id = ${input.candidateId}, validation_run_id = ${input.validationRunId},
        pull_request_number = ${input.pullRequest.number}
      WHERE change_id = ${internalChangeId(input.changeId, idPrefix)}
    `;
    const stored = yield* requirePublicationChange(sql, input.changeId, idPrefix);
    const publication = stored.publication;
    if (
      publication === null ||
      publication.pullRequest === null ||
      !samePublicationTarget(publication, input) ||
      publication.candidateId !== input.candidateId ||
      publication.validationRunId !== input.validationRunId ||
      publication.expectedHeadSha !== input.expectedHeadSha ||
      publication.pullRequest.number !== input.pullRequest.number
    ) {
      return { ok: false as const, code: "publication_state_conflict" as const };
    }
    return {
      ok: true as const,
      change: {
        ...stored,
        publication: { ...publication, pullRequest: publication.pullRequest },
      } satisfies PublishedCandidatePublicationChange,
    };
  });

const requirePublicationChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(getPublicationById(sql, changeId, idPrefix), (change) =>
    change === undefined
      ? invalidData("read Change publication", "Change disappeared")
      : Effect.succeed(change),
  );

const requirePending = (change: CandidatePublicationChange): PendingCandidatePublicationChange => {
  if (change.publication === null || change.publication.pullRequest !== null) {
    throw new Error("Pending Change publication was not stored");
  }
  return { ...change, publication: { ...change.publication, pullRequest: null } };
};

const selectOpenChange = (change: CandidatePublicationChange | undefined) => {
  if (change === undefined) return { ok: false as const, code: "change_not_found" as const };
  return change.state === "closed"
    ? { ok: false as const, code: "change_closed" as const }
    : { ok: true as const, change };
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
  publication.candidateId === input.candidateId &&
  publication.validationRunId === input.validationRunId &&
  sameTarget(publication.target, input.target) &&
  publication.headBranch === input.headBranch &&
  publication.expectedHeadSha === input.expectedHeadSha;
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
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
