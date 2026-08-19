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
import { openSqliteCandidatePublicationPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeReadPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeInspectionPersistence.js";
import { openSqliteChangeReconciliationPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteChangeSubmissionPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeSubmissionPersistence.js";
import { openSqliteTerminalChangeCleanupPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteTaskChangeCancellationPort } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import {
  openSqliteTaskChangeReconciliationCompletion,
  openSqliteTaskChangeSubmissionCompletion,
} from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
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
    reconciliationCompletion: openSqliteTaskChangeReconciliationCompletion(),
    cancellation: openSqliteTaskChangeCancellationPort(),
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
    submissionCompletion: openSqliteTaskChangeSubmissionCompletion(),
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
