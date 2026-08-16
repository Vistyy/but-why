import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangePublication, type ChangeState, changeState } from "../change/change.js";
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
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import type { SqliteChangePublicationRow } from "./sqliteChangePublication.js";
import {
  decodeChangePublication,
  decodeImplementationDecisions,
  type StoredImplementationDecisionRow,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { readCurrentPassingValidationEvidence } from "./sqlitePassingValidationEvidence.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteCandidatePublicationPort = () =>
  Effect.map(
    RepositorySql,
    (repository): CandidatePublicationPort => ({
      getChangeById: (changeId) =>
        repository.transaction("read Change for publication", (sql) =>
          getPublicationById(sql, changeId),
        ),
      getCurrentPassingEvidence: (changeId, query) =>
        repository.transaction("read current passing Change evidence", (sql) =>
          readCurrentPassingValidationEvidence(sql, changeId, query),
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
const getPublicationById = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName = "read Change for publication",
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredCandidatePublicationChangeRow>(
      `SELECT ${publicationSelectionColumns}, branch_ref AS branchRef,
        starting_commit AS startingCommit,
        acceptance_context AS acceptanceContext
       FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => {
      const state = decodeSelectedChangeState(row, changeId);
      return {
        ...state,
        branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
        startingCommit: decodeStoredNullableString(row.startingCommit, "Change starting commit"),
        acceptanceContext:
          row.acceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(
                decodeStoredString(row.acceptanceContext, "Change Acceptance Context"),
              ),
        publication: decodeChangePublication(row),
      };
    });
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    const implementationDecisions =
      selected.state === changeState.open ? yield* listDecisions(sql, selected.id) : [];
    return { ...selected, implementationDecisions } satisfies CandidatePublicationChange;
  });
const requireCandidatePublicationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(getPublicationById(sql, changeId, operationName), (change) =>
    change === undefined
      ? invalidData(operationName, "Change disappeared")
      : Effect.succeed(change),
  );
const requirePendingCandidatePublicationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(requireCandidatePublicationChange(sql, changeId, operationName), (change) => {
    const publication = change.publication;
    return publication === null || publication.pullRequest !== null
      ? invalidData(operationName, "Pending Change publication was not stored")
      : Effect.succeed({
          ...change,
          publication: { ...publication, pullRequest: null },
        } satisfies PendingCandidatePublicationChange);
  });
const requirePublishedCandidatePublicationChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(requireCandidatePublicationChange(sql, changeId, operationName), (change) => {
    const publication = change.publication;
    return publication === null || publication.pullRequest === null
      ? invalidData(operationName, "Published Change pull request was not stored")
      : Effect.succeed({
          ...change,
          publication: { ...publication, pullRequest: publication.pullRequest },
        } satisfies PublishedCandidatePublicationChange);
  });
const requireReleasedCandidatePublication = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(requireCandidatePublicationChange(sql, changeId, operationName), (change) =>
    change.publication === null
      ? Effect.succeed({ publication: null })
      : invalidData(operationName, "Change publication was not released"),
  );
const readChangeState = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredChangeStateRow>`
      SELECT id, state FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => decodeSelectedChangeState(row, changeId));
  });
const readPublicationChange = (sql: SqlClient.SqlClient, changeId: string, operationName: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<PublicationSelectionRow>(
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
        change: yield* requirePendingCandidatePublicationChange(
          sql,
          input.changeId,
          "begin Change publication",
        ),
      };
    }
    yield* sql`UPDATE changes SET publication_candidate_id = ${input.candidateId}, publication_validation_run_id = ${input.validationRunId}, publication_owner = ${input.target.owner}, publication_repo = ${input.target.repo}, publication_base_branch = ${input.target.baseBranch}, publication_remote_name = ${input.target.remoteName}, publication_head_branch = ${input.headBranch}, publication_expected_head_sha = ${input.expectedHeadSha}, publication_pr_number = NULL, publication_pr_url = NULL, updated_at = ${input.now} WHERE id = ${input.changeId}`;
    return {
      ok: true as const,
      created: true,
      change: yield* requirePendingCandidatePublicationChange(
        sql,
        input.changeId,
        "begin Change publication",
      ),
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
      change: yield* requirePendingCandidatePublicationChange(
        sql,
        input.changeId,
        "replace pending Change publication",
      ),
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
      ...(yield* requireReleasedCandidatePublication(
        sql,
        input.changeId,
        "release Change publication",
      )),
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
      change: yield* requirePublishedCandidatePublicationChange(
        sql,
        input.changeId,
        "record Change publication",
      ),
    };
  });
const selectOpenChange = <A extends { readonly state: ChangeState }>(
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
type StoredChangeStateRow = {
  readonly id: unknown;
  readonly state: unknown;
};
type PublicationSelectionRow = StoredChangeStateRow & SqliteChangePublicationRow;
type StoredCandidatePublicationChangeRow = PublicationSelectionRow & {
  readonly branchRef: unknown;
  readonly startingCommit: unknown;
  readonly acceptanceContext: unknown;
};
