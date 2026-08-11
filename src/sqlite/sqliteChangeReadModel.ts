import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import type { CandidateCaptureChange } from "../change/candidateCapture/candidateCapturePersistence.js";
import type { ChangeCleanup, ChangeRecord, ChangeState } from "../change/change.js";
import type { ChangeStartRecord } from "../change/changeStartStore.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "../change/implementationBlocker.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type { ReviewerSessionRecord } from "../change/reviewerSession/reviewerSession.js";
import type { ReviewerTranscript } from "../change/reviewerSession/reviewerTranscript.js";
import { storedPublicTaskId } from "../task/taskId.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import { decodeSqliteChangePrepareFailure } from "./sqliteChangePreparation.js";
import {
  decodeSqliteChangePublication,
  type SqliteChangePublicationRow,
} from "./sqliteChangePublication.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const changeReadColumns = [
  "id",
  "repository_common_directory AS repositoryCommonDirectory",
  "branch_ref AS branchRef",
  "base_ref AS baseRef",
  "base_remote_url AS baseRemoteUrl",
  "task_id AS taskId",
  "starting_commit AS startingCommit",
  "worktree_path AS worktreePath",
  "acceptance_context AS acceptanceContext",
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
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly baseRemoteUrl: string | null;
  readonly taskId: string | null;
  readonly startingCommit: string | null;
  readonly worktreePath: string | null;
  readonly acceptanceContext: string | null;
  readonly prepareCommand: string | null;
  readonly prepareTimeoutSeconds: number | null;
  readonly prepareFailure: string | null;
  readonly cleanupState: ChangeCleanup["state"];
  readonly cleanupBlockingReason: string | null;
  readonly state: ChangeState;
  readonly closeReason: ChangeRecord["closeReason"];
  readonly cancelReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
} & SqliteChangePublicationRow;

export const decodeChangeRow = (row: StoredChangeRow): ChangeRecord => {
  const id = row.id;
  const taskId = row.taskId;
  const encodedAcceptanceContext = row.acceptanceContext;
  const baseRef = row.baseRef;
  const baseRemoteUrl = row.baseRemoteUrl;
  const startingCommit = row.startingCommit;
  const worktreePath = row.worktreePath;
  const prepareCommand = row.prepareCommand;
  const { prepareTimeoutSeconds } = row;
  const encodedPrepareFailure = row.prepareFailure;
  const { state } = row;
  const { closeReason } = row;
  const closedAt = row.closedAt;
  const cancelReason = row.cancelReason;

  const { cleanupState } = row;
  const { cleanupBlockingReason } = row;
  return {
    id,
    repositoryCommonDirectory: row.repositoryCommonDirectory,
    branchRef: row.branchRef,
    baseRef,
    baseRemoteUrl,
    taskId: taskId === null ? null : storedPublicTaskId(taskId),
    startingCommit,
    worktreePath,
    acceptanceContext:
      encodedAcceptanceContext === null
        ? null
        : decodeSqliteAcceptanceContextSnapshot(encodedAcceptanceContext),
    prepare:
      prepareCommand === null || prepareTimeoutSeconds === null
        ? null
        : { command: prepareCommand, timeoutSeconds: prepareTimeoutSeconds },
    prepareFailure:
      encodedPrepareFailure === null
        ? null
        : decodeSqliteChangePrepareFailure(encodedPrepareFailure),
    publication: decodeChangePublication(row),
    cleanup: { state: cleanupState, blockingReason: cleanupBlockingReason },
    state,
    closeReason,
    cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt,
  };
};

export const requireChangeStartRecord = (change: ChangeRecord): ChangeStartRecord => {
  if (
    change.baseRef === null ||
    change.baseRemoteUrl === null ||
    change.startingCommit === null ||
    change.worktreePath === null
  ) {
    throw new Error("Stored Change Start relationship is incomplete");
  }
  return {
    ...change,
    baseRef: change.baseRef,
    baseRemoteUrl: change.baseRemoteUrl,
    startingCommit: change.startingCommit,
    worktreePath: change.worktreePath,
  };
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
  return row;
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
): ReviewerTranscript => {
  if (row.changeId !== changeId) throw new Error("Reviewer Transcript belongs to another Change");
  return row;
};

export const validateChangeRelationships = (
  sql: SqlClient.SqlClient,
  change: ChangeRecord,
  operationName: string,
) =>
  Effect.gen(function* () {
    if (change.taskId !== null) {
      const taskRows = yield* sql<{ readonly id: string }>`
        SELECT id FROM tasks WHERE id = ${change.taskId}
      `;
      yield* decodePersisted(operationName, () => {
        const taskId = taskRows[0]?.id;
        if (taskId !== change.taskId) throw new Error("Change belongs to an unknown Task");
      });
    }

    yield* validateChangePublicationRelationships(
      sql,
      change.id,
      change.publication,
      operationName,
    );
  });

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
  readonly id: string;
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly baseRef: string | null;
  readonly state: ChangeState;
};

export const decodeCandidateCaptureChange = (
  row: StoredCandidateCaptureChangeRow,
): CandidateCaptureChange => row;

export const decodeChangePublication = (row: SqliteChangePublicationRow) =>
  decodeSqliteChangePublication(row);

const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
