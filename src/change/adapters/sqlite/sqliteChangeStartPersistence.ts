import { join } from "node:path";

import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import type { ChangePrepareFailure } from "../../change.js";
import { changeBranchRefForSlug } from "../../changeBranch.js";
import { internalChangeId, publicChangeId } from "../../changeId.js";
import { decodeSqliteChangePolicy, encodeSqliteChangePolicy } from "../../changePolicy.js";
import type { ChangeStartPersistence } from "../../changeStartPersistence.js";
import type { ChangeStartRecord, CreateChangeStartInput } from "../../changeStartStore.js";
import type { AcceptanceContextSnapshotV1 } from "../../validationRun/acceptanceContextSnapshot.js";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "./sqliteAcceptanceContextSnapshot.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "./sqliteChangePreparation.js";
import { decodeStoredNullableString, decodeStoredString } from "./sqliteChangeValueDecoders.js";

export const openSqliteChangeStartPersistence = (): Effect.Effect<
  ChangeStartPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    create: (input) =>
      repository.transactionImmediate("create Change Start", (sql) =>
        createChange(sql, input, repository.idPrefix),
      ),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) =>
        readChangeStartById(sql, changeId, repository.idPrefix),
      ),
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        recordPrepareOutcome(sql, changeId, failure, now, repository.idPrefix),
      ),
  }));

type UntrustedCreateChangeStartInput = Omit<CreateChangeStartInput, "policy"> & {
  readonly policy: unknown;
};

export const createChange = (
  sql: SqlClient.SqlClient,
  input: UntrustedCreateChangeStartInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const inserted = yield* insertChangeRow(sql, input, null, idPrefix);
    if (!inserted.ok) return inserted;
    const change = yield* readChangeStartById(sql, inserted.changeId, idPrefix);
    return change === undefined
      ? yield* invalidData("create Change Start", "Change disappeared")
      : { ok: true as const, change };
  });

export const insertLinkedChange = (
  sql: SqlClient.SqlClient,
  input: CreateChangeStartInput,
  acceptanceContext: AcceptanceContextSnapshotV1,
  idPrefix: string,
) => insertChangeRow(sql, input, acceptanceContext, idPrefix);

const insertChangeRow = (
  sql: SqlClient.SqlClient,
  input: UntrustedCreateChangeStartInput,
  acceptanceContext: AcceptanceContextSnapshotV1 | null,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const policy = yield* Effect.try({
      try: () => encodeSqliteChangePolicy(input.policy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({ operationName: "create Change Start", cause }),
    });
    const allocated = yield* sql<{ readonly id: number }>`
      INSERT INTO changes (
        branch_ref, base_ref, base_remote_url, worktree_path,
        initial_acceptance_context, reviewer_configuration,
        prepare_definition, checks_definition, prepare_failure, close_reason, cancel_reason,
        cleanup_pending, cleanup_blocking_reason
      ) VALUES (
        'refs/heads/but-why/pending-' || lower(hex(randomblob(16))),
        ${input.baseRef}, ${input.baseRemoteUrl},
        'pending-worktree-' || lower(hex(randomblob(16))),
        ${acceptanceContext === null ? null : encodeSqliteAcceptanceContextSnapshot(acceptanceContext)},
        ${policy.reviewerConfiguration},
        ${policy.prepareDefinition},
        ${policy.checksDefinition},
        NULL, NULL, NULL, 0, NULL
      )
      RETURNING id
    `;
    const allocatedId = allocated[0]?.id;
    if (allocatedId === undefined) {
      return yield* invalidData("create Change Start", "Change identity was not allocated");
    }
    const changeId = publicChangeId(idPrefix, allocatedId);
    const branchRef = changeBranchRefForSlug(changeId);
    const worktreePath = join(input.managedWorktreeParent, changeId);
    const finalConflicts = yield* sql<{ readonly id: number }>`
      SELECT id FROM changes
      WHERE id <> ${allocatedId} AND (branch_ref = ${branchRef} OR worktree_path = ${worktreePath})
      LIMIT 1
    `;
    if (finalConflicts.length > 0) {
      yield* sql`DELETE FROM changes WHERE id = ${allocatedId}`;
      return { ok: false as const, code: "change_start_conflict" as const };
    }
    yield* sql`
      UPDATE changes SET branch_ref = ${branchRef}, worktree_path = ${worktreePath}
      WHERE id = ${allocatedId}
    `;
    return { ok: true as const, changeId };
  });

export const recordPrepareOutcome = (
  sql: SqlClient.SqlClient,
  changeId: string,
  failure: ChangePrepareFailure | null,
  _now: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE changes
      SET prepare_failure = ${failure === null ? null : encodeSqliteChangePrepareFailure(failure)}
      WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    const change = yield* readChangeStartById(sql, changeId, idPrefix);
    return change === undefined
      ? yield* invalidData("record Change preparation outcome", "Change was not found")
      : change;
  });

const changeStartSelectionColumns = `
  change_row.id,
  identity.common_directory AS repositoryCommonDirectory,
  change_row.branch_ref AS branchRef, change_row.base_ref AS baseRef,
  change_row.base_remote_url AS baseRemoteUrl, change_row.worktree_path AS worktreePath,
  change_row.initial_acceptance_context AS acceptanceContext,
  change_row.reviewer_configuration AS reviewerConfiguration,
  change_row.prepare_definition AS prepareDefinition,
  change_row.checks_definition AS checksDefinition,
  change_row.prepare_failure AS prepareFailure,
  change_row.close_reason AS closeReason
`;

type StoredChangeStartRow = {
  readonly id: number;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly baseRemoteUrl: unknown;
  readonly worktreePath: unknown;
  readonly acceptanceContext: unknown;
  readonly reviewerConfiguration: unknown;
  readonly prepareDefinition: unknown;
  readonly checksDefinition: unknown;
  readonly prepareFailure: unknown;
  readonly closeReason: unknown;
};

export const readChangeStartById = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeStartRow>(
      `SELECT ${changeStartSelectionColumns}
       FROM changes AS change_row
       CROSS JOIN shared_state_identity AS identity
       WHERE identity.id = 1 AND change_row.id = ?`,
      [internalChangeId(changeId, idPrefix)],
    ),
    (rows) => mapRow(rows[0], idPrefix),
  );

const mapRow = (row: StoredChangeStartRow | undefined, idPrefix: string) =>
  row === undefined
    ? Effect.succeed(undefined)
    : decodePersisted("read Change Start", () => decodeChangeStart(row, idPrefix));

const decodeChangeStart = (row: StoredChangeStartRow, idPrefix: string): ChangeStartRecord => {
  const encodedAcceptanceContext = decodeStoredNullableString(
    row.acceptanceContext,
    "Change Acceptance Context",
  );
  const encodedReviewerConfiguration = decodeStoredString(
    row.reviewerConfiguration,
    "Change Reviewer Configuration",
  );
  const encodedPrepareDefinition = decodeStoredNullableString(
    row.prepareDefinition,
    "Change prepare definition",
  );
  const encodedChecksDefinition = decodeStoredString(
    row.checksDefinition,
    "Change Checks definition",
  );
  const encodedPrepareFailure = decodeStoredNullableString(
    row.prepareFailure,
    "Change prepare failure",
  );
  const policy = decodeSqliteChangePolicy({
    reviewerConfiguration: encodedReviewerConfiguration,
    prepareDefinition: encodedPrepareDefinition,
    checksDefinition: encodedChecksDefinition,
  });
  if (encodedPrepareFailure !== null && policy.prepare === null) {
    throw new Error("Stored Change preparation failure relationship is incomplete");
  }
  return {
    id: publicChangeId(idPrefix, row.id),
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
    baseRef: decodeStoredString(row.baseRef, "Change Base ref"),
    baseRemoteUrl: decodeStoredString(row.baseRemoteUrl, "Change Base remote URL"),
    worktreePath: decodeStoredString(row.worktreePath, "Change worktree path"),
    acceptanceContext:
      encodedAcceptanceContext === null
        ? null
        : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
    policy,
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    state: row.closeReason === null ? "open" : "closed",
  };
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
