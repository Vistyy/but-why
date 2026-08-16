import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ReviewerSessionRecord } from "../agent/reviewerSession/reviewerSession.js";
import type { CandidateCaptureChange } from "../change/candidateCapture/candidateCapturePersistence.js";
import type { ChangeRecord } from "../change/change.js";
import type { ChangeReviewerConfiguration } from "../change/changeStartStore.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "../change/implementationBlocker.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type { LegacyReviewerTranscriptReference } from "../change/legacyReviewerTranscript.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { changeIdSqlParameter } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { decodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import {
  decodeChangeCleanup,
  decodeChangeLifecycle,
  decodeChangeState,
  decodeStoredNullableString,
  decodeStoredPositiveInteger,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const changeReadColumns = [
  "id",
  "repository_common_directory AS repositoryCommonDirectory",
  "branch_ref AS branchRef",
  "base_ref AS baseRef",
  "base_remote_url AS baseRemoteUrl",
  "starting_commit AS startingCommit",
  "worktree_path AS worktreePath",
  "acceptance_context AS acceptanceContext",
  "reviewer_configuration AS reviewerConfiguration",
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
  "cancel_reason AS cancelReason",
  "created_at AS createdAt",
  "updated_at AS updatedAt",
  "closed_at AS closedAt",
].join(", ");

export type StoredChangeRow = {
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
  readonly cleanupState: unknown;
  readonly cleanupBlockingReason: unknown;
  readonly state: unknown;
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly closedAt: unknown;
} & SqliteChangePublicationRow;

export type ChangeWithoutAuthorityHistory = Omit<
  ChangeRecord,
  "implementationDecisions" | "activeBlocker"
>;

export const decodeChangeRow = (row: StoredChangeRow): ChangeWithoutAuthorityHistory => {
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
  const encodedPrepareFailure = decodeStoredNullableString(
    row.prepareFailure,
    "Change prepare failure",
  );
  if (encodedPrepareFailure !== null && prepareCommand === null) {
    throw new Error("Stored Change preparation failure relationship is incomplete");
  }
  const lifecycle = decodeChangeLifecycle(row);
  const closedAt = decodeStoredNullableString(row.closedAt, "Change closure time");
  if ((lifecycle.state === "open") !== (closedAt === null)) {
    throw new Error("Stored Change closure relationship is invalid");
  }
  const cleanup = decodeChangeCleanup(row.cleanupState, row.cleanupBlockingReason);
  if (
    lifecycle.state === "open" &&
    (cleanup.state !== "complete" || cleanup.blockingReason !== null)
  ) {
    throw new Error("Stored open Change cleanup relationship is invalid");
  }
  const cancelReason = decodeStoredNullableString(row.cancelReason, "Change cancellation reason");
  if (cancelReason !== null && lifecycle.closeReason !== "cancelled") {
    throw new Error("Stored Change cancellation relationship is invalid");
  }
  const encodedReviewerConfiguration = decodeStoredNullableString(
    row.reviewerConfiguration,
    "Change Reviewer Configuration",
  );
  return {
    id: decodeStoredString(row.id, "Change id"),
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
    baseRef: decodeStoredNullableString(row.baseRef, "Change Base ref"),
    baseRemoteUrl: decodeStoredNullableString(row.baseRemoteUrl, "Change Base remote URL"),
    startingCommit: decodeStoredNullableString(row.startingCommit, "Change starting commit"),
    worktreePath: decodeStoredNullableString(row.worktreePath, "Change worktree path"),
    acceptanceContext:
      encodedAcceptanceContext === null
        ? null
        : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
    reviewerConfiguration:
      encodedReviewerConfiguration === null
        ? null
        : decodeChangeReviewerConfiguration(encodedReviewerConfiguration),
    prepare:
      prepareCommand === null || prepareTimeoutSeconds === null
        ? null
        : { command: prepareCommand, timeoutSeconds: prepareTimeoutSeconds },
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    publication: decodeChangePublication(row),
    cleanup,
    ...lifecycle,
    cancelReason,
    createdAt: decodeStoredString(row.createdAt, "Change creation time"),
    updatedAt: decodeStoredString(row.updatedAt, "Change update time"),
    closedAt,
  };
};

const decodeChangeReviewerConfiguration = (source: string): ChangeReviewerConfiguration => {
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

export type StoredImplementationDecisionRow = {
  readonly id: string;
  readonly changeId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly choice: string;
  readonly rationale: string;
};

export const decodeImplementationDecisions = (
  rows: readonly StoredImplementationDecisionRow[],
  changeId: string,
): readonly ImplementationDecision[] =>
  rows
    .map((row): ImplementationDecision => {
      if (row.changeId !== changeId) {
        throw new Error("Implementation Decision belongs to another Change");
      }
      return row;
    })
    .sort((left, right) => left.sequence - right.sequence);

export const implementationBlockerReadColumns = `
  sequence,
  id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt,
  resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt,
  resolution_content AS resolutionContent
`;

export const readImplementationBlockerHistory = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE change_id = ?`,
      [changeIdSqlParameter(changeId)],
    ),
    (rows) =>
      decodePersisted(operationName, () => decodeImplementationBlockerHistory(rows, changeId)),
  );

export const deriveAcceptanceContext = (
  initial: AcceptanceContextSnapshotV1 | null,
  history: ImplementationBlockerHistory,
): AcceptanceContextSnapshotV1 | null => {
  if (initial === null) return null;
  const resolutions =
    history.resolutions.length === 0
      ? (initial.resolutions ?? [])
      : history.resolutions.map((resolution) => resolution.content);
  return {
    version: initial.version,
    title: initial.title,
    description: initial.description,
    ...(initial.comments === undefined ? {} : { comments: [...initial.comments] }),
    ...(resolutions.length === 0 ? {} : { resolutions }),
  };
};

export type StoredImplementationBlockerRow = {
  readonly sequence: number;
  readonly id: string;
  readonly changeId: string;
  readonly reportedAt: string;
  readonly content: string;
  readonly resolvedAt: string | null;
  readonly resolutionId: string | null;
  readonly resolutionRecordedAt: string | null;
  readonly resolutionContent: string | null;
};

export const decodeImplementationBlockerHistory = (
  rows: readonly StoredImplementationBlockerRow[],
  changeId: string,
): ImplementationBlockerHistory => {
  const blockers = rows
    .map((row): ImplementationBlocker => {
      if (row.changeId !== changeId) {
        throw new Error("Implementation Blocker belongs to another Change");
      }
      return {
        id: row.id,
        changeId: row.changeId,
        sequence: row.sequence,
        reportedAt: row.reportedAt,
        content: row.content,
        resolvedAt: row.resolvedAt,
        resolution:
          row.resolutionId === null ||
          row.resolutionRecordedAt === null ||
          row.resolutionContent === null
            ? null
            : {
                id: row.resolutionId,
                blockerId: row.id,
                recordedAt: row.resolutionRecordedAt,
                content: row.resolutionContent,
              },
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
  const active = blockers.filter((blocker) => blocker.resolvedAt === null);
  return {
    blockers,
    resolutions: blockers.flatMap((blocker) =>
      blocker.resolution === null ? [] : [blocker.resolution],
    ),
    active: active[0] ?? null,
  };
};

export const latestResolvedBlockerId = (history: ImplementationBlockerHistory): string | null =>
  [...history.blockers]
    .filter(
      (blocker): blocker is typeof blocker & { readonly resolvedAt: string } =>
        blocker.resolvedAt !== null,
    )
    .sort(
      (left, right) =>
        compareStoredStrings(right.resolvedAt, left.resolvedAt) || right.sequence - left.sequence,
    )[0]?.id ?? null;

export type StoredReviewerSessionRow = {
  readonly changeId: string;
  readonly producer: string;
  readonly fingerprint: string;
  readonly sessionReference: string;
};

export const decodeReviewerSession = (
  row: StoredReviewerSessionRow,
  changeId: string,
): ReviewerSessionRecord => {
  if (row.changeId !== changeId) throw new Error("Reviewer Session belongs to another Change");
  return {
    ownerId: row.changeId,
    producer: row.producer,
    fingerprint: row.fingerprint,
    sessionReference: row.sessionReference,
  };
};

export type StoredReviewerTranscriptRow = {
  readonly changeId: string;
  readonly producer: string;
  readonly piSessionId: string;
  readonly filePath: string;
};

export const decodeReviewerTranscript = (
  row: StoredReviewerTranscriptRow,
  changeId: string,
): LegacyReviewerTranscriptReference => {
  if (row.changeId !== changeId) throw new Error("Reviewer Transcript belongs to another Change");
  return row;
};

export const validateChangePublicationRelationships = (
  sql: SqlClient.SqlClient,
  changeId: string,
  publication: ChangeRecord["publication"],
  operationName: string,
) =>
  publication === null
    ? Effect.void
    : Effect.flatMap(
        sql<{
          readonly candidateChangeId: string;
          readonly candidateHeadSha: string;
          readonly validationRunCandidateId: string | null;
        }>`
          SELECT candidate.change_id AS candidateChangeId, candidate.head_sha AS candidateHeadSha,
            validation_run.candidate_id AS validationRunCandidateId
          FROM candidates AS candidate
          LEFT JOIN candidate_validation_runs AS validation_run
            ON validation_run.id = ${publication.validationRunId}
          WHERE candidate.id = ${publication.candidateId}
        `,
        (rows) =>
          decodePersisted(operationName, () => {
            const row = rows[0];
            if (row === undefined) throw new Error("Publication Candidate was not selected");
            const { candidateChangeId, candidateHeadSha, validationRunCandidateId } = row;
            if (candidateChangeId !== changeId) {
              throw new Error("Publication Candidate belongs to another Change");
            }
            if (validationRunCandidateId !== publication.candidateId) {
              throw new Error("Publication Validation Run belongs to another Candidate");
            }
            if (candidateHeadSha !== publication.expectedHeadSha) {
              throw new Error("Publication expected head does not match its Candidate");
            }
          }),
      );

export type StoredCandidateCaptureChangeRow = {
  readonly id: unknown;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly state: unknown;
};

export const decodeCandidateCaptureChange = (
  row: StoredCandidateCaptureChangeRow,
): CandidateCaptureChange => ({
  id: decodeStoredString(row.id, "Change id"),
  repositoryCommonDirectory: decodeStoredString(
    row.repositoryCommonDirectory,
    "Change repository common directory",
  ),
  branchRef: decodeStoredString(row.branchRef, "Change branch ref"),
  baseRef: decodeStoredNullableString(row.baseRef, "Change Base ref"),
  state: decodeChangeState(row.state),
});

export const decodeChangePublication = (row: SqliteChangePublicationRow) =>
  decodeSqliteChangePublication(row);

const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
