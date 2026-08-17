import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangePublication } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { CompleteMergedChangeInput } from "../change/changeStore.js";
import type { ObservedMergedChangeEvidence } from "../change/ownedPullRequestClassifier.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import {
  decodeChangePublication,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  type StoredTerminalChangeRow,
  terminalChangeSelectionColumns,
} from "./sqliteTerminalChangeStorage.js";

const operationName = "complete merged Change";

export const completeMergedChange = (
  sql: SqlClient.SqlClient,
  input: CompleteMergedChangeInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const lifecycle = yield* readChangeLifecycle(sql, input.changeId, operationName, idPrefix);
    if (lifecycle === undefined) return { ok: false as const, code: "change_not_found" as const };
    if (lifecycle.state === "closed") {
      if (lifecycle.closeReason !== "completed") {
        return { ok: false as const, code: "change_already_closed" as const };
      }
      return { ok: true as const, changed: false };
    }
    const change = yield* readCompleteChange(sql, input.changeId, idPrefix);
    if (change === undefined) return yield* invalidData("Change disappeared");
    if (!matchesExactMergedEvidence(change, input.observed)) {
      return { ok: false as const, code: "publication_mismatch" as const };
    }
    yield* sql`
      UPDATE changes
      SET close_reason = 'completed', cleanup_pending = 1, cleanup_blocking_reason = NULL
      WHERE id = ${internalChangeId(input.changeId, idPrefix)} AND close_reason IS NULL
    `;
    return { ok: true as const, changed: true };
  });

export const readChangeLifecycle = (
  sql: SqlClient.SqlClient,
  changeId: string,
  selectedOperationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<{ readonly id: number; readonly closeReason: string | null }>`
      SELECT id, close_reason AS closeReason
      FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `,
    (rows) =>
      decodePersisted(selectedOperationName, () => {
        const row = rows[0];
        if (row === undefined) return undefined;
        const id = publicChangeId(idPrefix, row.id);
        if (id !== changeId) throw new Error("Change identity does not match lookup");
        if (
          row.closeReason !== null &&
          row.closeReason !== "completed" &&
          row.closeReason !== "cancelled"
        ) {
          throw new Error("Change close reason is unsupported");
        }
        return {
          id,
          state: row.closeReason === null ? ("open" as const) : ("closed" as const),
          closeReason: row.closeReason,
        };
      }),
  );

const readCompleteChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredTerminalChangeRow>(
      `SELECT ${terminalChangeSelectionColumns} FROM changes WHERE id = ?`,
      [internalChangeId(changeId, idPrefix)],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () => ({
      id: publicChangeId(idPrefix, row.id),
      publication: decodeChangePublication(row),
    }));
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
      idPrefix,
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
