import { Effect } from "effect";
import type {
  CandidatePublicationPort,
  ChangeAgentSessionPort,
  ChangeAuthorityPort,
  ChangeReadPort,
  ChangeReconciliationPort,
  ChangeSubmissionPort,
  TerminalChangeCleanupPort,
} from "../../src/change/changePorts.js";
import { openSqliteCandidatePublicationPort } from "../../src/sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../src/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeReadPort } from "../../src/sqlite/sqliteChangeInspectionPersistence.js";
import { openSqliteChangeReconciliationPort } from "../../src/sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteChangeSubmissionPort } from "../../src/sqlite/sqliteChangeSubmissionPersistence.js";
import { openSqliteTerminalChangeCleanupPort } from "../../src/sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteTaskChangeCancellationPort } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import {
  openSqliteTaskChangeReconciliationCompletion,
  openSqliteTaskChangeSubmissionCompletion,
} from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
import {
  taskChangeCancellationOperations,
  taskChangeCompletionOperations,
} from "../../src/taskChange/composition/loadTaskChangePersistence.js";
import type { TaskChangeCancellationPort } from "../../src/taskChange/taskChangePorts.js";

type ChangeDeliveryTestPort = {
  readonly getChangeById: ChangeReconciliationPort["getChangeById"];
  readonly listChangesForReconciliation: ChangeReconciliationPort["listChangesForReconciliation"];
  readonly completeMergedChange: ChangeReconciliationPort["completeMergedChange"];
  readonly cancelChange: TaskChangeCancellationPort["cancelChange"];
  readonly recordCleanup: TerminalChangeCleanupPort["recordCleanup"];
};

const openChangeDeliveryTestPort = () =>
  Effect.all({
    reconciliationOwner: openSqliteChangeReconciliationPort(),
    reconciliationCompletion: openSqliteTaskChangeReconciliationCompletion(
      taskChangeCompletionOperations,
    ),
    cancellation: openSqliteTaskChangeCancellationPort(
      taskChangeCancellationOperations,
      taskChangeCompletionOperations,
    ),
    cleanup: openSqliteTerminalChangeCleanupPort(),
  }).pipe(
    Effect.map(
      ({
        reconciliationOwner,
        reconciliationCompletion,
        cancellation,
        cleanup,
      }): ChangeDeliveryTestPort => ({
        getChangeById: reconciliationOwner.getChangeById,
        listChangesForReconciliation: reconciliationOwner.listChangesForReconciliation,
        completeMergedChange: reconciliationCompletion,
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
    agentSessions: openSqliteChangeAgentSessionPort(),
    publication: openSqliteCandidatePublicationPort(),
    submissionOwner: openSqliteChangeSubmissionPort(),
    submissionCompletion: openSqliteTaskChangeSubmissionCompletion(taskChangeCompletionOperations),
  }).pipe(
    Effect.map(
      ({
        authority,
        delivery,
        reads,
        agentSessions,
        publication,
        submissionOwner,
        submissionCompletion,
      }) => {
        const submission: ChangeSubmissionPort = {
          getChangeById: submissionOwner.getChangeById,
          getChangeForOutputById: submissionOwner.getChangeForOutputById,
          getCompletedPublicationEvidence: submissionOwner.getCompletedPublicationEvidence,
          completeMergedChange: submissionCompletion,
        };
        return {
          authority,
          delivery,
          reads,
          agentSessions,
          publication,
          submission,
        };
      },
    ),
  );

export type ChangeTestDependencies = {
  readonly authority: ChangeAuthorityPort;
  readonly delivery: ChangeDeliveryTestPort;
  readonly reads: ChangeReadPort;
  readonly agentSessions: ChangeAgentSessionPort;
  readonly publication: CandidatePublicationPort;
  readonly submission: ChangeSubmissionPort;
};
