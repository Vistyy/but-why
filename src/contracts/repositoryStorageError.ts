import { Data } from "effect";

export type RestoredTransientTaskFact = {
  readonly id: string;
  readonly numericId: number;
  readonly title: string;
  readonly state: string;
  readonly changeId: string | null;
};

export type RestoredTransientChangeFact = {
  readonly id: string;
  readonly taskId: string | null;
  readonly state: string;
};

export class RestoredTransientStateError extends Data.TaggedError("RestoredTransientStateError")<{
  readonly tasks: readonly RestoredTransientTaskFact[];
  readonly changes: readonly RestoredTransientChangeFact[];
}> {}

export class RepositoryStateUnavailable extends Data.TaggedError("RepositoryStateUnavailable")<{
  readonly statePath: string;
  readonly cause: unknown;
}> {}

export class RepositoryIdentityConflict extends Data.TaggedError("RepositoryIdentityConflict")<{
  readonly expectedCommonDirectory: string;
  readonly actualCommonDirectory: string;
}> {}

export class RepositoryIdPrefixConflict extends Data.TaggedError("RepositoryIdPrefixConflict")<{
  readonly configuredIdPrefix: string;
  readonly storedIdPrefix: string;
}> {}

export class RepositorySqlOperationFailed extends Data.TaggedError("RepositorySqlOperationFailed")<{
  readonly operationName: string;
  readonly cause: unknown;
}> {}

export type PredecessorReconciliationBlockedConditions = {
  readonly openChanges: number;
  readonly activeTaskReviews: number;
  readonly activeValidationRuns: number;
  readonly unsettledAgentInvocations: number;
  readonly pendingTaskReviewCleanup: number;
  readonly pendingValidationCleanup: number;
  readonly pendingChangeCleanup: number;
};

export class PredecessorReconciliationRequiredError extends Data.TaggedError(
  "PredecessorReconciliationRequiredError",
)<{
  readonly blocked: PredecessorReconciliationBlockedConditions;
}> {}

export class RepositoryMigrationFailed extends Data.TaggedError("RepositoryMigrationFailed")<{
  readonly statePath: string;
  readonly cause: unknown;
}> {}

export class RepositoryPredecessorReconciliationRequired extends Data.TaggedError(
  "RepositoryPredecessorReconciliationRequired",
)<{
  readonly blocked: PredecessorReconciliationBlockedConditions;
}> {}

export class RepositoryRestoredTransientState extends Data.TaggedError(
  "RepositoryRestoredTransientState",
)<{
  readonly tasks: readonly RestoredTransientTaskFact[];
  readonly changes: readonly RestoredTransientChangeFact[];
}> {}

export class RepositoryPersistedDataInvalid extends Data.TaggedError(
  "RepositoryPersistedDataInvalid",
)<{
  readonly operationName: string;
  readonly cause: unknown;
}> {}

export type RepositoryStorageError =
  | RepositoryStateUnavailable
  | RepositoryIdentityConflict
  | RepositoryIdPrefixConflict
  | RepositorySqlOperationFailed
  | RepositoryMigrationFailed
  | RepositoryPredecessorReconciliationRequired
  | RepositoryRestoredTransientState
  | RepositoryPersistedDataInvalid;
