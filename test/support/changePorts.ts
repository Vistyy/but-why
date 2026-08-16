import { Effect } from "effect";
import type {
  CandidatePublicationPort,
  ChangeAuthorityPort,
  ChangeCancellationPort,
  ChangeReadPort,
  ChangeReconciliationPort,
  ChangeReviewerSessionPort,
  ChangeReviewerTranscriptPort,
  ChangeSubmissionPort,
  TerminalChangeCleanupPort,
} from "../../src/change/changePorts.js";
import { openSqliteCandidatePublicationPort } from "../../src/sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../src/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeReadPort } from "../../src/sqlite/sqliteChangeInspectionPersistence.js";
import { openSqliteChangeReconciliationPort } from "../../src/sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteChangeReviewerSessionPort } from "../../src/sqlite/sqliteChangeReviewerSessionPersistence.js";
import { openSqliteChangeReviewerTranscriptPort } from "../../src/sqlite/sqliteChangeReviewerTranscriptPersistence.js";
import { openSqliteChangeSubmissionPort } from "../../src/sqlite/sqliteChangeSubmissionPersistence.js";
import { openSqliteTerminalChangeCleanupPort } from "../../src/sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteTaskChangeCancellationPort } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import {
  openSqliteTaskChangeReconciliationPort,
  openSqliteTaskChangeSubmissionPort,
} from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";

type ChangeDeliveryTestPort = {
  readonly getChangeById: ChangeReconciliationPort["getChangeById"];
  readonly listChangesForReconciliation: ChangeReconciliationPort["listChangesForReconciliation"];
  readonly completeMergedChange: ChangeReconciliationPort["completeMergedChange"];
  readonly cancelChange: ChangeCancellationPort["cancelChange"];
  readonly recordCleanup: TerminalChangeCleanupPort["recordCleanup"];
};

const openChangeDeliveryTestPort = () =>
  Effect.all({
    reconciliation: openSqliteTaskChangeReconciliationPort(openSqliteChangeReconciliationPort()),
    cancellation: openSqliteTaskChangeCancellationPort(),
    cleanup: openSqliteTerminalChangeCleanupPort(),
  }).pipe(
    Effect.map(
      ({ reconciliation, cancellation, cleanup }): ChangeDeliveryTestPort => ({
        getChangeById: reconciliation.getChangeById,
        listChangesForReconciliation: reconciliation.listChangesForReconciliation,
        completeMergedChange: reconciliation.completeMergedChange,
        cancelChange: cancellation.cancelChange,
        recordCleanup: cleanup.recordCleanup,
      }),
    ),
  );

export const openSqliteChangeTestDependencies = () =>
  Effect.all({
    authority: openSqliteChangeAuthorityPort(),
    delivery: openChangeDeliveryTestPort(),
    reads: openSqliteChangeReadPort(),
    reviewerSessions: openSqliteChangeReviewerSessionPort(),
    reviewerTranscripts: openSqliteChangeReviewerTranscriptPort(),
    publication: openSqliteCandidatePublicationPort(),
    submission: openSqliteTaskChangeSubmissionPort(openSqliteChangeSubmissionPort()),
  });

export type ChangeTestDependencies = {
  readonly authority: ChangeAuthorityPort;
  readonly delivery: ChangeDeliveryTestPort;
  readonly reads: ChangeReadPort;
  readonly reviewerSessions: ChangeReviewerSessionPort;
  readonly reviewerTranscripts: ChangeReviewerTranscriptPort;
  readonly publication: CandidatePublicationPort;
  readonly submission: ChangeSubmissionPort;
};
