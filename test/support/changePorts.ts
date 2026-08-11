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
import {
  openSqliteCandidatePublicationPort,
  openSqliteChangeAuthorityPort,
  openSqliteChangeCancellationPort,
  openSqliteChangeReadPort,
  openSqliteChangeReconciliationPort,
  openSqliteChangeReviewerSessionPort,
  openSqliteChangeReviewerTranscriptPort,
  openSqliteChangeSubmissionPort,
  openSqliteTerminalChangeCleanupPort,
} from "../../src/sqlite/sqliteChangePersistence.js";

type ChangeDeliveryTestPort = {
  readonly getChangeById: ChangeReconciliationPort["getChangeById"];
  readonly listChangesForReconciliation: ChangeReconciliationPort["listChangesForReconciliation"];
  readonly completeMergedChange: ChangeReconciliationPort["completeMergedChange"];
  readonly cancelChange: ChangeCancellationPort["cancelChange"];
  readonly recordCleanup: TerminalChangeCleanupPort["recordCleanup"];
};

const openChangeDeliveryTestPort = () =>
  Effect.all({
    reconciliation: openSqliteChangeReconciliationPort(),
    cancellation: openSqliteChangeCancellationPort(),
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
    submission: openSqliteChangeSubmissionPort(),
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
