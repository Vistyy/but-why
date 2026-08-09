import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeRecord, ChangeState } from "../change/change.js";
import { changeState } from "../change/change.js";
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
import { decodeSqliteChangePublication } from "./sqliteChangePublication.js";
import {
  decodePersisted,
  decodeStoredNullableString,
  decodeStoredSqlitePositiveInteger,
  decodeStoredString,
} from "./sqliteTaskReadModel.js";

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
  "CAST(prepare_timeout_seconds AS TEXT) AS prepareTimeoutSeconds",
  "typeof(prepare_timeout_seconds) AS prepareTimeoutSecondsType",
  "prepare_failure AS prepareFailure",
  "publication_candidate_id AS publicationCandidateId",
  "publication_validation_run_id AS publicationValidationRunId",
  "publication_owner AS publicationOwner",
  "publication_repo AS publicationRepo",
  "publication_base_branch AS publicationBaseBranch",
  "publication_remote_name AS publicationRemoteName",
  "publication_head_branch AS publicationHeadBranch",
  "publication_expected_head_sha AS publicationExpectedHeadSha",
  "CAST(publication_pr_number AS TEXT) AS publicationPrNumber",
  "typeof(publication_pr_number) AS publicationPrNumberType",
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

export type UnknownChangeRow = {
  readonly id: unknown;
  readonly repositoryCommonDirectory: unknown;
  readonly branchRef: unknown;
  readonly baseRef: unknown;
  readonly baseRemoteUrl: unknown;
  readonly taskId: unknown;
  readonly startingCommit: unknown;
  readonly worktreePath: unknown;
  readonly acceptanceContext: unknown;
  readonly prepareCommand: unknown;
  readonly prepareTimeoutSeconds: unknown;
  readonly prepareTimeoutSecondsType: unknown;
  readonly prepareFailure: unknown;
  readonly publicationCandidateId: unknown;
  readonly publicationValidationRunId: unknown;
  readonly publicationOwner: unknown;
  readonly publicationRepo: unknown;
  readonly publicationBaseBranch: unknown;
  readonly publicationRemoteName: unknown;
  readonly publicationHeadBranch: unknown;
  readonly publicationExpectedHeadSha: unknown;
  readonly publicationPrNumber: unknown;
  readonly publicationPrNumberType: unknown;
  readonly publicationPrUrl: unknown;
  readonly cleanupState: unknown;
  readonly cleanupBlockingReason: unknown;
  readonly state: unknown;
  readonly closeReason: unknown;
  readonly cancelReason: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly closedAt: unknown;
};

export const decodeChangeRow = (row: UnknownChangeRow): ChangeRecord => {
  const id = decodeStoredString(row.id, "Change ID");
  const taskId = decodeStoredNullableString(row.taskId, "Change Task ID");
  const encodedAcceptanceContext = decodeStoredNullableString(
    row.acceptanceContext,
    "Change Acceptance Context",
  );
  if ((taskId === null) !== (encodedAcceptanceContext === null)) {
    throw new Error("Stored Change Task and Acceptance Context relationship is incomplete");
  }

  const prepareCommand = decodeStoredNullableString(row.prepareCommand, "Change prepare command");
  const prepareTimeoutSeconds = decodeNullablePositiveInteger(
    row.prepareTimeoutSeconds,
    row.prepareTimeoutSecondsType,
    "Change prepare timeout",
  );
  if ((prepareCommand === null) !== (prepareTimeoutSeconds === null)) {
    throw new Error("Stored Change preparation relationship is incomplete");
  }
  const encodedPrepareFailure = decodeStoredNullableString(
    row.prepareFailure,
    "Change preparation failure",
  );
  if (encodedPrepareFailure !== null && prepareCommand === null) {
    throw new Error("Stored Change preparation failure has no preparation definition");
  }

  const state = decodeChangeState(row.state);
  const closeReason = decodeCloseReason(row.closeReason);
  const closedAt = decodeStoredNullableString(row.closedAt, "Change closure time");
  if (
    (state === changeState.open && (closeReason !== null || closedAt !== null)) ||
    (state === changeState.closed && (closeReason === null || closedAt === null))
  ) {
    throw new Error("Stored Change lifecycle relationship is inconsistent");
  }
  const cancelReason = decodeStoredNullableString(row.cancelReason, "Change cancellation reason");
  if (cancelReason !== null && (state !== changeState.closed || closeReason !== "cancelled")) {
    throw new Error("Stored Change cancellation reason is inconsistent with lifecycle");
  }

  const cleanupState = decodeStoredString(row.cleanupState, "Change cleanup state");
  if (cleanupState !== "complete" && cleanupState !== "pending") {
    throw new Error("Stored Change cleanup state is unsupported");
  }
  const cleanupBlockingReason = decodeStoredNullableString(
    row.cleanupBlockingReason,
    "Change cleanup blocking reason",
  );
  if (cleanupState === "complete" && cleanupBlockingReason !== null) {
    throw new Error("Stored completed Change cleanup has a blocking reason");
  }

  const publicationPrNumber = decodeNullablePositiveInteger(
    row.publicationPrNumber,
    row.publicationPrNumberType,
    "Change publication pull request number",
  );

  return {
    id,
    repositoryCommonDirectory: decodeStoredString(
      row.repositoryCommonDirectory,
      "Change repository common directory",
    ),
    branchRef: decodeStoredString(row.branchRef, "Change Repository Branch"),
    baseRef: decodeStoredNullableString(row.baseRef, "Change Base ref"),
    baseRemoteUrl: decodeStoredNullableString(row.baseRemoteUrl, "Change Base remote URL"),
    taskId: taskId === null ? null : storedPublicTaskId(taskId),
    startingCommit: decodeStoredNullableString(row.startingCommit, "Change starting commit"),
    worktreePath: decodeStoredNullableString(row.worktreePath, "Change Managed Worktree path"),
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
    publication: decodeSqliteChangePublication({
      publicationCandidateId: decodeStoredNullableString(
        row.publicationCandidateId,
        "Change publication Candidate ID",
      ),
      publicationValidationRunId: decodeStoredNullableString(
        row.publicationValidationRunId,
        "Change publication Validation Run ID",
      ),
      publicationOwner: decodeStoredNullableString(row.publicationOwner, "publication owner"),
      publicationRepo: decodeStoredNullableString(row.publicationRepo, "publication repository"),
      publicationBaseBranch: decodeStoredNullableString(
        row.publicationBaseBranch,
        "publication base branch",
      ),
      publicationRemoteName: decodeStoredNullableString(
        row.publicationRemoteName,
        "publication remote name",
      ),
      publicationHeadBranch: decodeStoredNullableString(
        row.publicationHeadBranch,
        "publication head branch",
      ),
      publicationExpectedHeadSha: decodeStoredNullableString(
        row.publicationExpectedHeadSha,
        "publication expected head SHA",
      ),
      publicationPrNumber,
      publicationPrUrl: decodeStoredNullableString(
        row.publicationPrUrl,
        "publication pull request URL",
      ),
    }),
    cleanup: { state: cleanupState, blockingReason: cleanupBlockingReason },
    state,
    closeReason,
    cancelReason,
    createdAt: decodeStoredString(row.createdAt, "Change creation time"),
    updatedAt: decodeStoredString(row.updatedAt, "Change update time"),
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

export type UnknownImplementationDecisionRow = {
  readonly id: unknown;
  readonly changeId: unknown;
  readonly sequence: unknown;
  readonly sequenceType: unknown;
  readonly recordedAt: unknown;
  readonly choice: unknown;
  readonly rationale: unknown;
};

export const decodeImplementationDecisions = (
  rows: readonly UnknownImplementationDecisionRow[],
  changeId: string,
): readonly ImplementationDecision[] => {
  const ids = new Set<string>();
  const sequences = new Set<number>();
  return rows
    .map((row): ImplementationDecision => {
      const id = decodeStoredString(row.id, "Implementation Decision ID");
      const owner = decodeStoredString(row.changeId, "Implementation Decision Change ID");
      const sequence = decodeStoredSqlitePositiveInteger(
        row.sequence,
        row.sequenceType,
        "Implementation Decision sequence",
      );
      if (owner !== changeId) throw new Error("Implementation Decision belongs to another Change");
      if (ids.has(id) || sequences.has(sequence)) {
        throw new Error("Duplicate Implementation Decision identity");
      }
      ids.add(id);
      sequences.add(sequence);
      return {
        id,
        changeId: owner,
        sequence,
        recordedAt: decodeStoredString(row.recordedAt, "Implementation Decision recorded time"),
        choice: decodeStoredString(row.choice, "Implementation Decision choice"),
        rationale: decodeStoredString(row.rationale, "Implementation Decision rationale"),
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
};

export const implementationBlockerReadColumns = `
  CAST(sequence AS TEXT) AS sequence, typeof(sequence) AS sequenceType,
  id, change_id AS changeId, reported_at AS reportedAt, content, resolved_at AS resolvedAt,
  resolution_id AS resolutionId, resolution_recorded_at AS resolutionRecordedAt,
  resolution_content AS resolutionContent
`;

export type UnknownImplementationBlockerRow = {
  readonly sequence: unknown;
  readonly sequenceType: unknown;
  readonly id: unknown;
  readonly changeId: unknown;
  readonly reportedAt: unknown;
  readonly content: unknown;
  readonly resolvedAt: unknown;
  readonly resolutionId?: unknown;
  readonly resolutionRecordedAt?: unknown;
  readonly resolutionContent?: unknown;
};

export const decodeImplementationBlockerHistory = (
  rows: readonly UnknownImplementationBlockerRow[],
  changeId: string,
): ImplementationBlockerHistory => {
  const ids = new Set<string>();
  const sequences = new Set<number>();
  const resolutionIds = new Set<string>();
  const blockers = rows
    .map((row): ImplementationBlocker => {
      const id = decodeStoredString(row.id, "Implementation Blocker ID");
      const owner = decodeStoredString(row.changeId, "Implementation Blocker Change ID");
      const sequence = decodeStoredSqlitePositiveInteger(
        row.sequence,
        row.sequenceType,
        "Implementation Blocker sequence",
      );
      if (owner !== changeId) throw new Error("Implementation Blocker belongs to another Change");
      if (ids.has(id) || sequences.has(sequence))
        throw new Error("Duplicate Implementation Blocker identity");
      ids.add(id);
      sequences.add(sequence);
      const resolvedAt = decodeStoredNullableString(
        row.resolvedAt,
        "Implementation Blocker resolution time",
      );
      const resolutionId = decodeStoredNullableString(row.resolutionId ?? null, "Resolution ID");
      const resolutionRecordedAt = decodeStoredNullableString(
        row.resolutionRecordedAt ?? null,
        "Resolution recorded time",
      );
      const resolutionContent = decodeStoredNullableString(
        row.resolutionContent ?? null,
        "Resolution content",
      );
      const resolutionParts = [resolvedAt, resolutionId, resolutionRecordedAt, resolutionContent];
      if (
        !resolutionParts.every((part) => part === null) &&
        !resolutionParts.every((part) => part !== null)
      ) {
        throw new Error("Implementation Blocker resolution relationship is incomplete");
      }
      if (resolutionId !== null) {
        if (resolutionIds.has(resolutionId)) {
          throw new Error("Implementation Blocker Resolution belongs to multiple Blockers");
        }
        resolutionIds.add(resolutionId);
      }
      return {
        id,
        changeId: owner,
        sequence,
        reportedAt: decodeStoredString(row.reportedAt, "Implementation Blocker reported time"),
        content: decodeStoredString(row.content, "Implementation Blocker content"),
        resolvedAt,
        resolution:
          resolutionId === null || resolutionRecordedAt === null || resolutionContent === null
            ? null
            : {
                id: resolutionId,
                blockerId: id,
                recordedAt: resolutionRecordedAt,
                content: resolutionContent,
              },
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
  const active = blockers.filter((blocker) => blocker.resolvedAt === null);
  if (active.length > 1) throw new Error("Change has multiple active Implementation Blockers");
  return {
    blockers,
    resolutions: blockers.flatMap((blocker) =>
      blocker.resolution === null ? [] : [blocker.resolution],
    ),
    active: active[0] ?? null,
  };
};

export const decodeReviewerSession = (
  row: Record<string, unknown>,
  changeId: string,
): ReviewerSessionRecord => {
  const owner = decodeStoredString(row["changeId"], "Reviewer Session Change ID");
  if (owner !== changeId) throw new Error("Reviewer Session belongs to another Change");
  return {
    changeId: owner,
    producer: decodeStoredString(row["producer"], "Reviewer Session producer"),
    fingerprint: decodeStoredString(row["fingerprint"], "Reviewer Session fingerprint"),
    sessionReference: decodeStoredString(row["sessionReference"], "Reviewer Session reference"),
  };
};

export const decodeReviewerTranscript = (
  row: Record<string, unknown>,
  changeId: string,
): ReviewerTranscript => {
  const owner = decodeStoredString(row["changeId"], "Reviewer Transcript Change ID");
  if (owner !== changeId) throw new Error("Reviewer Transcript belongs to another Change");
  return {
    changeId: owner,
    producer: decodeStoredString(row["producer"], "Reviewer Transcript producer"),
    piSessionId: decodeStoredString(row["piSessionId"], "Reviewer Transcript Pi session ID"),
    filePath: decodeStoredString(row["filePath"], "Reviewer Transcript file path"),
  };
};

export const validateChangeRelationships = (
  sql: SqlClient.SqlClient,
  change: ChangeRecord,
  operationName: string,
) =>
  Effect.gen(function* () {
    if (change.taskId !== null) {
      const taskRows = yield* sql<Record<string, unknown>>`
        SELECT id FROM tasks WHERE id = ${change.taskId}
      `;
      yield* decodePersisted(operationName, () => {
        const taskId = decodeStoredString(taskRows[0]?.["id"], "linked Task ID");
        if (taskId !== change.taskId) throw new Error("Change belongs to an unknown Task");
      });
    }

    if (change.publication !== null) {
      const publicationRows = yield* sql<Record<string, unknown>>`
        SELECT candidate.change_id AS candidateChangeId,
          validation_run.candidate_id AS validationRunCandidateId
        FROM candidates AS candidate
        LEFT JOIN candidate_validation_runs AS validation_run
          ON validation_run.id = ${change.publication.validationRunId}
        WHERE candidate.id = ${change.publication.candidateId}
      `;
      yield* decodePersisted(operationName, () => {
        const row = publicationRows[0];
        const candidateChangeId = decodeStoredString(
          row?.["candidateChangeId"],
          "publication Candidate Change ID",
        );
        const validationRunCandidateId = decodeStoredString(
          row?.["validationRunCandidateId"],
          "publication Validation Run Candidate ID",
        );
        if (candidateChangeId !== change.id) {
          throw new Error("Publication Candidate belongs to another Change");
        }
        if (validationRunCandidateId !== change.publication?.candidateId) {
          throw new Error("Publication Validation Run belongs to another Candidate");
        }
      });
    }
  });

export const decodeCandidateCaptureChange = (row: Record<string, unknown>) => ({
  id: decodeStoredString(row["id"], "Candidate capture Change ID"),
  repositoryCommonDirectory: decodeStoredString(
    row["repositoryCommonDirectory"],
    "Candidate capture repository common directory",
  ),
  branchRef: decodeStoredString(row["branchRef"], "Candidate capture Repository Branch"),
  baseRef: decodeStoredNullableString(row["baseRef"], "Candidate capture Change Base ref"),
  state: decodeChangeState(row["state"]),
});

const decodeChangeState = (value: unknown): ChangeState => {
  const state = decodeStoredString(value, "Change state");
  if (state !== changeState.open && state !== changeState.closed) {
    throw new Error("Stored Change state is unsupported");
  }
  return state;
};

const decodeCloseReason = (value: unknown): ChangeRecord["closeReason"] => {
  const reason = decodeStoredNullableString(value, "Change close reason");
  if (reason !== null && reason !== "completed" && reason !== "cancelled") {
    throw new Error("Stored Change close reason is unsupported");
  }
  return reason;
};

const decodeNullablePositiveInteger = (
  value: unknown,
  storageType: unknown,
  field: string,
): number | null => {
  if (storageType === "null" && value === null) return null;
  return decodeStoredSqlitePositiveInteger(value, storageType, field);
};
