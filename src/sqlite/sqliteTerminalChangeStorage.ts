import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangePublication } from "../change/change.js";
import type { ReconciliationChange } from "../change/changePorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { SqliteChangePublicationRow } from "./sqliteChangePublication.js";
import {
  decodeChangePublication,
  validateChangePublicationRelationships,
} from "./sqliteChangeReadModel.js";
import {
  decodeChangeCleanup,
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const terminalChangeSelectionColumns = `
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
  repository_common_directory AS repositoryCommonDirectory,
  branch_ref AS branchRef,
  base_remote_url AS baseRemoteUrl,
  worktree_path AS worktreePath,
  cleanup_state AS cleanupState,
  cleanup_blocking_reason AS cleanupBlockingReason
`;

export const readTerminalChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredTerminalChangeRow>(
      `SELECT ${terminalChangeSelectionColumns} FROM changes WHERE id = ?`,
      [changeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const selected = yield* decodePersisted(operationName, () =>
      decodeTerminalChange(row, changeId),
    );
    yield* validateChangePublicationRelationships(
      sql,
      selected.id,
      selected.publication,
      operationName,
    );
    return selected;
  });

export const requireTerminalChange = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(readTerminalChange(sql, changeId, operationName), (change) =>
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
): ReconciliationChange => {
  const publication = decodeChangePublication(row);
  const base = {
    id: decodeSelectedChangeId(row, changeId),
    state: decodeChangeState(row.state),
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
    worktreePath: decodeStoredNullableString(row.worktreePath, "Change worktree path"),
    cleanup: decodeChangeCleanup(row.cleanupState, row.cleanupBlockingReason),
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
  const baseRemoteUrl = decodeStoredNullableString(row.baseRemoteUrl, "Change Base remote URL");
  return {
    ...base,
    publication: ownedPublication,
    remoteChangeBranch: remoteChangeBranchForPublication(ownedPublication, baseRemoteUrl),
  };
};

const decodeSelectedChangeId = (row: StoredChangeStateRow, changeId: string) => {
  const id = decodeStoredString(row.id, "Change id");
  if (id !== changeId) throw new Error("Change identity does not match lookup");
  return id;
};

const remoteChangeBranchForPublication = (
  publication: ChangePublication & {
    readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
  },
  baseRemoteUrl: string | null,
) => {
  if (baseRemoteUrl === null) throw new Error("Published Change lacks its Base remote URL");
  return {
    owner: publication.target.owner,
    repo: publication.target.repo,
    remoteName: publication.target.remoteName,
    remoteUrl: baseRemoteUrl,
    branchName: publication.headBranch,
    targetBranch: publication.target.baseBranch,
    expectedHeadSha: publication.expectedHeadSha,
  };
};

type StoredChangeStateRow = {
  readonly id: unknown;
  readonly state: unknown;
};
export type StoredTerminalChangeRow = StoredChangeStateRow &
  SqliteChangePublicationRow & {
    readonly repositoryCommonDirectory: unknown;
    readonly branchRef: unknown;
    readonly baseRemoteUrl: unknown;
    readonly worktreePath: unknown;
    readonly cleanupState: unknown;
    readonly cleanupBlockingReason: unknown;
  };
