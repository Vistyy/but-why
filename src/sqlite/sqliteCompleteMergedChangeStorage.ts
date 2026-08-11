import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type ChangePublication, changeState } from "../change/change.js";
import type { CompleteMergedChangeInput } from "../change/changeStore.js";
import type { ObservedMergedChangeEvidence } from "../change/ownedPullRequestClassifier.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { SqliteChangePublicationRow } from "./sqliteChangePublication.js";
import {
  decodeChangePublication,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeLifecycle,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

const operationName = "complete merged Change";
const completeChangeSelectionColumns = `
  id, state,
  publication_candidate_id AS publicationCandidateId,
  publication_validation_run_id AS publicationValidationRunId,
  publication_owner AS publicationOwner, publication_repo AS publicationRepo,
  publication_base_branch AS publicationBaseBranch,
  publication_remote_name AS publicationRemoteName,
  publication_head_branch AS publicationHeadBranch,
  publication_expected_head_sha AS publicationExpectedHeadSha,
  publication_pr_number AS publicationPrNumber,
  publication_pr_url AS publicationPrUrl,
  close_reason AS closeReason,
  task_id AS taskId
`;

export const completeMergedChange = (sql: SqlClient.SqlClient, input: CompleteMergedChangeInput) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, operationName);
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === changeState.closed) {
      if (lifecycle.closeReason !== "completed") {
        return { ok: false as const, code: "change_already_closed" as const };
      }
      return { ok: true as const, changed: false };
    }
    const change = yield* readCompleteChange(sql, input.changeId);
    if (change === undefined) return yield* invalidData("Change disappeared");
    if (!matchesExactMergedEvidence(change, input.observed)) {
      return { ok: false as const, code: "publication_mismatch" as const };
    }
    yield* sql`UPDATE changes SET state = 'closed', close_reason = 'completed', cleanup_state = 'pending', cleanup_blocking_reason = NULL, updated_at = ${input.now}, closed_at = ${input.now} WHERE id = ${input.changeId} AND state = 'open'`;
    if (change.taskId !== null)
      yield* sql`UPDATE tasks SET state = 'done', updated_at = ${input.now} WHERE id = ${change.taskId}`;
    return { ok: true as const, changed: true };
  });

export const readChangeLifecycle = (
  sql: SqlClient.SqlClient,
  changeId: string,
  selectedOperationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredChangeLifecycleRow>`
      SELECT id, state, close_reason AS closeReason
      FROM changes WHERE id = ${changeId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(selectedOperationName, () => {
      const id = decodeStoredString(row.id, "Change id");
      if (id !== changeId) throw new Error("Change identity does not match lookup");
      return { id, ...decodeChangeLifecycle(row) };
    });
  });

const readCompleteChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredCompleteChangeRow>(
      `SELECT ${completeChangeSelectionColumns} FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => {
      const id = decodeStoredString(row.id, "Change id");
      if (id !== changeId) throw new Error("Change identity does not match lookup");
      return {
        id,
        ...decodeChangeLifecycle(row),
        taskId: decodeStoredNullableString(row.taskId, "Change Task id"),
        publication: decodeChangePublication(row),
      };
    });
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
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

const invalidData = (message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

type StoredChangeLifecycleRow = {
  readonly id: unknown;
  readonly state: unknown;
  readonly closeReason: unknown;
};
type StoredCompleteChangeRow = StoredChangeLifecycleRow &
  SqliteChangePublicationRow & {
    readonly taskId: unknown;
  };
