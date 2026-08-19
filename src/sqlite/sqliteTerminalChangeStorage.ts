import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangeCleanup, ChangePublication } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { ReconciliationChange } from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import type { SqliteChangePublicationRow } from "./sqliteChangePublication.js";
import {
  decodeChangePublication,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";

export const terminalChangeSelectionColumns = `
  changes.id,
  CASE WHEN changes.close_reason IS NULL THEN 'open' ELSE 'closed' END AS state,
  (SELECT candidate_id FROM github_publications WHERE change_id = changes.id) AS publicationCandidateId,
  (SELECT validation_run_id FROM github_publications WHERE change_id = changes.id) AS publicationValidationRunId,
  (SELECT pull_request_number FROM github_publications WHERE change_id = changes.id) AS publicationPrNumber,
  changes.base_ref AS publicationBaseRef,
  changes.base_remote_url AS publicationBaseRemoteUrl,
  changes.branch_ref AS publicationBranchRef,
  (SELECT candidate.head_commit FROM github_publications AS publication JOIN candidates AS candidate ON candidate.id = publication.candidate_id WHERE publication.change_id = changes.id) AS publicationExpectedHeadSha,
  (SELECT common_directory FROM shared_state_identity WHERE id = 1) AS repositoryCommonDirectory,
  changes.branch_ref AS branchRef, changes.base_remote_url AS baseRemoteUrl,
  changes.worktree_path AS worktreePath, changes.cleanup_pending AS cleanupPending,
  changes.cleanup_blocking_reason AS cleanupBlockingReason
`;

export const readTerminalChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredTerminalChangeRow>(
      `SELECT ${terminalChangeSelectionColumns} FROM changes WHERE id = ?`,
      [internalChangeId(changeId, idPrefix)],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () =>
      decodeTerminalChange(row, changeId, idPrefix),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
      idPrefix,
    );
    return selected;
  });

export const requireTerminalChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(readTerminalChange(sql, changeId, operationName, idPrefix), (change) =>
    change === undefined
      ? Effect.fail(
          new RepositoryPersistedDataInvalid({
            operationName,
            cause: new Error("Change disappeared"),
          }),
        )
      : Effect.succeed(change),
  );

export const decodeTerminalChange = (
  row: StoredTerminalChangeRow,
  changeId: string,
  idPrefix: string,
): ReconciliationChange => {
  const publication = decodeChangePublication(row);
  const base = {
    id: decodeSelectedChangeId(row, changeId, idPrefix),
    state: decodeChangeState(row.state),
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
    worktreePath: decodeStoredString(row.worktreePath, "Change worktree path"),
    cleanup: decodeCleanup(row.cleanupPending, row.cleanupBlockingReason),
  };
  if (publication === null) return { ...base, publication, remoteChangeBranch: null };
  if (publication.pullRequest === null) {
    return {
      ...base,
      publication: { ...publication, pullRequest: null },
      remoteChangeBranch: null,
    };
  }
  const ownedPublication = { ...publication, pullRequest: publication.pullRequest };
  return {
    ...base,
    publication: ownedPublication,
    remoteChangeBranch: remoteChangeBranchForPublication(
      ownedPublication,
      decodeStoredString(row.baseRemoteUrl, "Change Base remote URL"),
    ),
  };
};

const decodeSelectedChangeId = (row: StoredChangeStateRow, changeId: string, idPrefix: string) => {
  const id = publicChangeId(idPrefix, row.id);
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return id;
};

const decodeCleanup = (pending: unknown, blockingReason: unknown): ChangeCleanup => {
  if (pending !== 0 && pending !== 1) throw new Error("Change cleanup state is unsupported");
  const reason = decodeStoredNullableString(blockingReason, "Change cleanup blocking reason");
  if (pending === 0 && reason !== null) throw new Error("Change cleanup relationship is invalid");
  return { state: pending === 0 ? "complete" : "pending", blockingReason: reason };
};

const remoteChangeBranchForPublication = (
  publication: ChangePublication & {
    readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
  },
  baseRemoteUrl: string,
) => ({
  owner: publication.target.owner,
  repo: publication.target.repo,
  remoteName: publication.target.remoteName,
  remoteUrl: baseRemoteUrl,
  branchName: publication.headBranch,
  targetBranch: publication.target.baseBranch,
  expectedHeadSha: publication.expectedHeadSha,
});

type StoredChangeStateRow = {
  readonly id: number;
  readonly state: unknown;
};
export type StoredTerminalChangeRow = StoredChangeStateRow &
  SqliteChangePublicationRow & {
    readonly repositoryCommonDirectory: unknown;
    readonly branchRef: unknown;
    readonly baseRemoteUrl: unknown;
    readonly worktreePath: unknown;
    readonly cleanupPending: unknown;
    readonly cleanupBlockingReason: unknown;
  };
