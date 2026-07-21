import type { Effect } from "effect";

import type { RepositoryStorageError } from "../repositoryStorageError.js";
import type { ChangePrepareFailure } from "./change.js";
import type {
  ChangeStartEligibilityError,
  ChangeStartRecord,
  CreateChangeStartInput,
} from "./changeStartStore.js";
import type { PublicTaskId } from "../task/taskId.js";

export type ChangeStartPersistence = {
  readonly prepareTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<
    | { readonly ok: true; readonly existing: ChangeStartRecord | undefined }
    | ChangeStartEligibilityError,
    RepositoryStorageError
  >;
  readonly create: (
    input: CreateChangeStartInput,
  ) => Effect.Effect<
    | { readonly ok: true; readonly change: ChangeStartRecord }
    | ChangeStartEligibilityError
    | { readonly ok: false; readonly code: "change_start_conflict" },
    RepositoryStorageError
  >;
  readonly getById: (
    changeId: string,
  ) => Effect.Effect<ChangeStartRecord | undefined, RepositoryStorageError>;
  readonly markReady: (
    changeId: string,
    now: string,
  ) => Effect.Effect<ChangeStartRecord, RepositoryStorageError>;
  readonly markPrepareFailed: (
    changeId: string,
    failure: ChangePrepareFailure,
    now: string,
  ) => Effect.Effect<ChangeStartRecord, RepositoryStorageError>;
};
