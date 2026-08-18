import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { ChangeCleanup, ChangeRecord } from "../change/change.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "../change/implementationBlocker.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { decodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import {
  decodePrepareDefinition,
  decodeReviewerConfiguration,
} from "./sqliteChangeStartPersistence.js";
import { decodeStoredNullableString, decodeStoredString } from "./sqliteChangeValueDecoders.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const changeReadColumns = [
  "changes.id",
  "(SELECT common_directory FROM shared_state_identity WHERE id = 1) AS repositoryCommonDirectory",
  "changes.branch_ref AS branchRef",
  "changes.base_ref AS baseRef",
  "changes.base_remote_url AS baseRemoteUrl",
  "changes.worktree_path AS worktreePath",
  "changes.initial_acceptance_context AS acceptanceContext",
  "changes.reviewer_configuration AS reviewerConfiguration",
  "changes.prepare_definition AS prepareDefinition",
  "changes.prepare_failure AS prepareFailure",
  "changes.cleanup_pending AS cleanupPending",
  "changes.cleanup_blocking_reason AS cleanupBlockingReason",
  "changes.close_reason AS closeReason",
  "changes.cancel_reason AS cancelReason",
  "(SELECT candidate_id FROM github_publications WHERE change_id = changes.id) AS publicationCandidateId",
  "(SELECT validation_run_id FROM github_publications WHERE change_id = changes.id) AS publicationValidationRunId",
  "(SELECT pull_request_number FROM github_publications WHERE change_id = changes.id) AS publicationPrNumber",
  "changes.base_ref AS publicationBaseRef",
  "changes.base_remote_url AS publicationBaseRemoteUrl",
  "changes.branch_ref AS publicationBranchRef",
  "(SELECT candidate.head_commit FROM github_publications AS publication JOIN candidates AS candidate ON candidate.id = publication.candidate_id WHERE publication.change_id = changes.id) AS publicationExpectedHeadSha",
].join(", ");

export type StoredChangeRow = {
  readonly id: number;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly baseRemoteUrl: unknown;
  readonly worktreePath: unknown;
  readonly acceptanceContext: unknown;
  readonly reviewerConfiguration: unknown;
  readonly prepareDefinition: unknown;
  readonly prepareFailure: unknown;
  readonly cleanupPending: unknown;
  readonly cleanupBlockingReason: unknown;
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
} & SqliteChangePublicationRow;

export type ChangeWithoutAuthorityHistory = Omit<
  ChangeRecord,
  "implementationDecisions" | "activeBlocker"
>;

export const decodeChangeRow = (
  row: StoredChangeRow,
  idPrefix: string,
): ChangeWithoutAuthorityHistory => {
  const encodedAcceptanceContext = decodeStoredNullableString(
    row.acceptanceContext,
    "Change Acceptance Context",
  );
  const encodedPrepareDefinition = decodeStoredNullableString(
    row.prepareDefinition,
    "Change prepare definition",
  );
  const prepare =
    encodedPrepareDefinition === null ? null : decodePrepareDefinition(encodedPrepareDefinition);
  const encodedPrepareFailure = decodeStoredNullableString(
    row.prepareFailure,
    "Change prepare failure",
  );
  if (encodedPrepareFailure !== null && prepare === null) {
    throw new Error("Stored Change preparation failure relationship is incomplete");
  }
  const closeReason = decodeCloseReason(row.closeReason);
  const cancelReason = decodeStoredNullableString(row.cancelReason, "Change cancellation reason");
  if ((closeReason === "cancelled") !== (cancelReason !== null)) {
    throw new Error("Stored Change cancellation relationship is invalid");
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
    reviewerConfiguration: decodeReviewerConfiguration(
      decodeStoredString(row.reviewerConfiguration, "Change Reviewer Configuration"),
    ),
    prepare,
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    publication: decodeSqliteChangePublication(row),
    cleanup: decodeCleanup(row.cleanupPending, row.cleanupBlockingReason),
    state: closeReason === null ? "open" : "closed",
    closeReason,
    cancelReason,
  };
};

export type StoredImplementationDecisionRow = {
  readonly id: number;
  readonly changeId: number;
  readonly choice: string;
  readonly rationale: string;
};

export const decodeImplementationDecisions = (
  rows: readonly StoredImplementationDecisionRow[],
  changeId: string,
  idPrefix: string,
): readonly ImplementationDecision[] =>
  rows
    .map((row): ImplementationDecision => {
      const storedChangeId = publicChangeId(idPrefix, row.changeId);
      if (storedChangeId !== changeId) {
        throw new Error("Implementation Decision belongs to another Change");
      }
      return { ...row, changeId: storedChangeId };
    })
    .sort((left, right) => left.id - right.id);

export const implementationBlockerReadColumns = `
  id, change_id AS changeId, content, resolution_content AS resolutionContent
`;

export const readImplementationBlockerHistory = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ?
       ORDER BY id`,
      [internalChangeId(changeId, idPrefix)],
    ),
    (rows) =>
      decodePersisted(operationName, () =>
        decodeImplementationBlockerHistory(rows, changeId, idPrefix),
      ),
  );

export const deriveAcceptanceContext = (
  initial: AcceptanceContextSnapshotV1 | null,
  history: ImplementationBlockerHistory,
): AcceptanceContextSnapshotV1 | null => {
  if (initial === null) return null;
  const resolutions = [
    ...(initial.resolutions ?? []),
    ...history.resolutions.map((resolution) => resolution.content),
  ];
  return {
    version: initial.version,
    title: initial.title,
    description: initial.description,
    ...(initial.comments === undefined ? {} : { comments: [...initial.comments] }),
    ...(resolutions.length === 0 ? {} : { resolutions }),
  };
};

export type StoredImplementationBlockerRow = {
  readonly id: number;
  readonly changeId: number;
  readonly content: string;
  readonly resolutionContent: string | null;
};

export const decodeImplementationBlockerHistory = (
  rows: readonly StoredImplementationBlockerRow[],
  changeId: string,
  idPrefix: string,
): ImplementationBlockerHistory => {
  const blockers = rows
    .map((row): ImplementationBlocker => {
      const storedChangeId = publicChangeId(idPrefix, row.changeId);
      if (storedChangeId !== changeId) {
        throw new Error("Implementation Blocker belongs to another Change");
      }
      return {
        id: row.id,
        changeId: storedChangeId,
        content: row.content,
        resolution:
          row.resolutionContent === null
            ? null
            : { blockerId: row.id, content: row.resolutionContent },
      };
    })
    .sort((left, right) => left.id - right.id);
  const active = blockers.filter((blocker) => blocker.resolution === null);
  if (active.length > 1) throw new Error("Change has more than one active Implementation Blocker");
  return {
    blockers,
    resolutions: blockers.flatMap((blocker) =>
      blocker.resolution === null ? [] : [blocker.resolution],
    ),
    active: active[0] ?? null,
  };
};

export const latestResolvedBlockerId = (history: ImplementationBlockerHistory): number | null =>
  [...history.blockers]
    .filter((blocker) => blocker.resolution !== null)
    .sort((left, right) => right.id - left.id)[0]?.id ?? null;

export const validateChangePublicationRelationships = (
  sql: SqlClient.SqlClient,
  changeId: string,
  publication: ChangeRecord["publication"],
  operationName: string,
  idPrefix: string,
) =>
  publication === null
    ? Effect.void
    : Effect.flatMap(
        sql<{
          readonly candidateChangeId: number;
          readonly candidateHeadSha: string;
          readonly validationRunCandidateId: number | null;
          readonly validationRunOutcome: string | null;
        }>`
          SELECT candidate.change_id AS candidateChangeId,
            candidate.head_commit AS candidateHeadSha,
            validation_run.candidate_id AS validationRunCandidateId,
            validation_run.outcome AS validationRunOutcome
          FROM candidates AS candidate
          LEFT JOIN validation_runs AS validation_run
            ON validation_run.id = ${publication.validationRunId}
          WHERE candidate.id = ${publication.candidateId}
        `,
        (rows) =>
          decodePersisted(operationName, () => {
            const row = rows[0];
            if (row === undefined) throw new Error("Publication Candidate was not selected");
            if (publicChangeId(idPrefix, row.candidateChangeId) !== changeId) {
              throw new Error("Publication Candidate belongs to another Change");
            }
            if (row.validationRunCandidateId !== publication.candidateId) {
              throw new Error("Publication Validation Run belongs to another Candidate");
            }
            if (row.validationRunOutcome !== "passed") {
              throw new Error("Publication Validation Run did not pass");
            }
            if (row.candidateHeadSha !== publication.expectedHeadSha) {
              throw new Error("Publication expected head does not match its Candidate");
            }
          }),
      );

export const decodeChangePublication = (row: SqliteChangePublicationRow) =>
  decodeSqliteChangePublication(row);

const decodeCloseReason = (value: unknown): ChangeRecord["closeReason"] => {
  if (value === null || value === "completed" || value === "cancelled") return value;
  throw new Error("Change close reason is unsupported");
};

const decodeCleanup = (pending: unknown, blockingReason: unknown): ChangeCleanup => {
  if (pending !== 0 && pending !== 1) throw new Error("Change cleanup state is unsupported");
  const reason = decodeStoredNullableString(blockingReason, "Change cleanup blocking reason");
  if (pending === 0 && reason !== null) throw new Error("Change cleanup relationship is invalid");
  return { state: pending === 0 ? "complete" : "pending", blockingReason: reason };
};
