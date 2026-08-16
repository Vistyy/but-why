import { dirname, join } from "node:path";

import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangePrepareFailure } from "../change/change.js";
import { changeBranchRefForSlug } from "../change/changeBranch.js";
import { publicChangeId } from "../change/changeId.js";
import type {
  ChangeStartPersistence,
  ChangeStartProvisioner,
} from "../change/changeStartPersistence.js";
import type {
  ChangeReviewerConfiguration,
  ChangeStartRecord,
  CreateChangeStartInput,
} from "../change/changeStartStore.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { changeIdSqlParameter, RepositorySql } from "./repositorySql.js";
import {
  decodeSqliteAcceptanceContextSnapshot,
  encodeSqliteAcceptanceContextSnapshot,
} from "./sqliteAcceptanceContextSnapshot.js";
import {
  decodeSqliteChangePrepareFailure,
  encodeSqliteChangePrepareFailure,
} from "./sqliteChangePreparation.js";
import {
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredPositiveInteger,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeStartPersistence = (): Effect.Effect<
  ChangeStartPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    create: (input, provision) =>
      repository.transactionImmediate("create Change Start", (sql) =>
        createChange(sql, input, repository.idPrefix, provision),
      ),
    getById: (changeId) =>
      repository.transaction("read Change Start", (sql) => readChangeStartById(sql, changeId)),
    recordPrepareOutcome: (changeId, failure, now) =>
      repository.transactionImmediate("record Change preparation outcome", (sql) =>
        recordPrepareOutcome(sql, changeId, failure, now),
      ),
  }));

export const createChange = (
  sql: SqlClient.SqlClient,
  input: CreateChangeStartInput,
  idPrefix = "BY",
  provision?: ChangeStartProvisioner,
) =>
  Effect.gen(function* () {
    const inserted = yield* insertChange(sql, input, idPrefix);
    if (!inserted.ok) return inserted;
    const change = yield* readChangeStartById(sql, inserted.changeId);
    if (change === undefined)
      return yield* invalidData("create Change Start", "Change disappeared");
    return yield* provisionCreatedChange(sql, change, provision);
  });

const insertChange = (sql: SqlClient.SqlClient, input: CreateChangeStartInput, idPrefix: string) =>
  insertChangeRow(sql, input, null, idPrefix);

export const insertLinkedChange = (
  sql: SqlClient.SqlClient,
  input: CreateChangeStartInput,
  acceptanceContext: AcceptanceContextSnapshotV1,
  idPrefix = "BY",
) => insertChangeRow(sql, input, acceptanceContext, idPrefix);

const insertChangeRow = (
  sql: SqlClient.SqlClient,
  input: CreateChangeStartInput,
  acceptanceContext: AcceptanceContextSnapshotV1 | null,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const conflicts = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes
      WHERE (repository_common_directory = ${input.repositoryCommonDirectory} AND branch_ref = ${input.branchRef})
        OR worktree_path = ${input.worktreePath}
      LIMIT 1
    `;
    if (conflicts.length > 0) {
      return { ok: false as const, code: "change_start_conflict" as const };
    }

    const allocated = yield* sql<{ readonly id: string }>`
      INSERT INTO changes (
        repository_common_directory, branch_ref, base_ref, base_remote_url,
        starting_commit, worktree_path, acceptance_context, reviewer_configuration,
        prepare_command, prepare_timeout_seconds, prepare_failure,
        state, close_reason, created_at, updated_at, closed_at
      ) VALUES (
        ${input.repositoryCommonDirectory}, ${input.branchRef}, ${input.baseRef},
        ${input.baseRemoteUrl}, ${input.startingCommit}, ${input.worktreePath},
        ${acceptanceContext === null ? null : encodeSqliteAcceptanceContextSnapshot(acceptanceContext)},
        ${JSON.stringify(input.reviewerConfiguration)},
        ${input.prepare?.command ?? null}, ${input.prepare?.timeoutSeconds ?? null},
        NULL, 'open', NULL, ${input.now}, ${input.now}, NULL
      )
      RETURNING id
    `;
    const allocatedId = allocated[0]?.id;
    if (allocatedId === undefined) {
      return yield* invalidData("create Change Start", "Change identity was not allocated");
    }
    const internalId = Number(allocatedId.slice(allocatedId.lastIndexOf("C") + 1));
    const changeId = publicChangeId(idPrefix, internalId);
    const branchRef = changeBranchRefForSlug(changeId);
    const worktreePath = join(dirname(input.worktreePath), changeId);
    const finalConflicts = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes
      WHERE id <> ${changeIdSqlParameter(changeId)} AND (
        (repository_common_directory = ${input.repositoryCommonDirectory} AND branch_ref = ${branchRef})
        OR worktree_path = ${worktreePath}
      )
      LIMIT 1
    `;
    if (finalConflicts.length > 0) {
      yield* deleteChangeStart(sql, changeId);
      return { ok: false as const, code: "change_start_conflict" as const };
    }
    yield* sql`
      UPDATE changes SET branch_ref = ${branchRef}, worktree_path = ${worktreePath}
      WHERE id = ${changeIdSqlParameter(changeId)}
    `;
    return { ok: true as const, changeId };
  });

export const provisionCreatedChange = (
  sql: SqlClient.SqlClient,
  change: ChangeStartRecord,
  provision?: ChangeStartProvisioner,
) =>
  Effect.gen(function* () {
    const provisioned = provision?.(change) ?? { ok: true as const };
    if (!provisioned.ok) {
      if (provisioned.code === "change_start_conflict") {
        yield* deleteChangeStart(sql, change.id);
      }
      return { ...provisioned, change };
    }
    return { ok: true as const, change };
  });

export const deleteChangeStart = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    yield* sql`
      DELETE FROM task_change_links WHERE change_id = ${changeIdSqlParameter(changeId)}
    `;
    yield* sql`DELETE FROM changes WHERE id = ${changeIdSqlParameter(changeId)}`;
  });

export const recordPrepareOutcome = (
  sql: SqlClient.SqlClient,
  changeId: string,
  failure: ChangePrepareFailure | null,
  now: string,
) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE changes SET prepare_failure = ${failure === null ? null : encodeSqliteChangePrepareFailure(failure)}, updated_at = ${now}
      WHERE id = ${changeIdSqlParameter(changeId)}
    `;
    const change = yield* readChangeStartById(sql, changeId);
    return change === undefined
      ? yield* invalidData("record Change preparation outcome", "Change was not found")
      : change;
  });

const changeStartSelectionColumns = `
  id, repository_common_directory AS repositoryCommonDirectory,
  branch_ref AS branchRef, base_ref AS baseRef, base_remote_url AS baseRemoteUrl,
  starting_commit AS startingCommit, worktree_path AS worktreePath,
  acceptance_context AS acceptanceContext, reviewer_configuration AS reviewerConfiguration,
  prepare_command AS prepareCommand,
  prepare_timeout_seconds AS prepareTimeoutSeconds,
  prepare_failure AS prepareFailure, state
`;

type StoredChangeStartRow = {
  readonly id: unknown;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly baseRemoteUrl: unknown;
  readonly startingCommit: unknown;
  readonly worktreePath: unknown;
  readonly acceptanceContext: unknown;
  readonly reviewerConfiguration: unknown;
  readonly prepareCommand: unknown;
  readonly prepareTimeoutSeconds: unknown;
  readonly prepareFailure: unknown;
  readonly state: unknown;
};

export const readChangeStartById = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.flatMap(
    sql.unsafe<StoredChangeStartRow>(
      `SELECT ${changeStartSelectionColumns} FROM changes WHERE id = ?`,
      [changeIdSqlParameter(changeId)],
    ),
    (rows) => mapRow(rows[0]),
  );

const mapRow = (row: StoredChangeStartRow | undefined) =>
  row === undefined
    ? Effect.succeed(undefined)
    : decodePersisted("read Change Start", () => decodeChangeStart(row));

const decodeChangeStart = (row: StoredChangeStartRow): ChangeStartRecord => {
  const baseRef = decodeStoredNullableString(row.baseRef, "Change Base ref");
  const baseRemoteUrl = decodeStoredNullableString(row.baseRemoteUrl, "Change Base remote URL");
  const startingCommit = decodeStoredNullableString(row.startingCommit, "Change starting commit");
  const worktreePath = decodeStoredNullableString(row.worktreePath, "Change worktree path");
  if (
    baseRef === null ||
    baseRemoteUrl === null ||
    startingCommit === null ||
    worktreePath === null
  ) {
    throw new Error("Stored Change Start relationship is incomplete");
  }
  const encodedAcceptanceContext = decodeStoredNullableString(
    row.acceptanceContext,
    "Change Acceptance Context",
  );
  const prepareCommand = decodeStoredNullableString(row.prepareCommand, "Change prepare command");
  const prepareTimeoutSeconds =
    row.prepareTimeoutSeconds === null
      ? null
      : decodeStoredPositiveInteger(row.prepareTimeoutSeconds, "Change prepare timeout");
  if ((prepareCommand === null) !== (prepareTimeoutSeconds === null)) {
    throw new Error("Stored Change preparation relationship is incomplete");
  }
  const encodedReviewerConfiguration = decodeStoredNullableString(
    row.reviewerConfiguration,
    "Change Reviewer Configuration",
  );
  const reviewerConfiguration =
    encodedReviewerConfiguration === null
      ? null
      : decodeReviewerConfiguration(encodedReviewerConfiguration);
  const encodedPrepareFailure = decodeStoredNullableString(
    row.prepareFailure,
    "Change prepare failure",
  );
  if (encodedPrepareFailure !== null && prepareCommand === null) {
    throw new Error("Stored Change preparation failure relationship is incomplete");
  }
  return {
    id: decodeStoredString(row.id, "Change id"),
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
    baseRef,
    baseRemoteUrl,
    startingCommit,
    worktreePath,
    acceptanceContext:
      encodedAcceptanceContext === null
        ? null
        : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
    reviewerConfiguration,
    prepare:
      prepareCommand === null || prepareTimeoutSeconds === null
        ? null
        : { command: prepareCommand, timeoutSeconds: prepareTimeoutSeconds },
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    state: decodeChangeState(row.state),
  };
};

const decodeReviewerConfiguration = (source: string): ChangeReviewerConfiguration => {
  const value: unknown = JSON.parse(source) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { specialistReviews?: unknown }).specialistReviews)
  ) {
    throw new Error("Stored Change Reviewer Configuration is invalid");
  }
  const configuration = value as ChangeReviewerConfiguration;
  if (
    configuration.acceptanceReview !== null &&
    typeof configuration.acceptanceReview !== "object"
  ) {
    throw new Error("Stored Change Acceptance Reviewer Configuration is invalid");
  }
  return configuration;
};

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
