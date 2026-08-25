import { Data } from "effect";

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

export class RepositoryMigrationFailed extends Data.TaggedError("RepositoryMigrationFailed")<{
  readonly statePath: string;
  readonly cause: unknown;
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
  | RepositoryPersistedDataInvalid;

export class StallDetectionBlockerObservationFailed extends Data.TaggedError(
  "StallDetectionBlockerObservationFailed",
)<{
  readonly storageError: RepositoryStorageError;
  readonly changeId: string;
  readonly guidance: string;
}> {}

export type RepositoryCommandError =
  | RepositoryStorageError
  | StallDetectionBlockerObservationFailed;
