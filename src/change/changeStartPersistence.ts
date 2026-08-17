import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { ChangePrepareFailure } from "./change.js";
import type { ChangeStartRecord, CreateChangeStartInput } from "./changeStartStore.js";

export type ChangeStartCreationResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "change_start_conflict" };

export type ChangeStartPersistence<CreationFailure = never> = {
  readonly create: (
    input: CreateChangeStartInput,
  ) => Effect.Effect<ChangeStartCreationResult | CreationFailure, RepositoryStorageError>;
  readonly getById: (
    changeId: string,
  ) => Effect.Effect<ChangeStartRecord | undefined, RepositoryStorageError>;
  readonly recordPrepareOutcome: (
    changeId: string,
    failure: ChangePrepareFailure | null,
    now: string,
  ) => Effect.Effect<ChangeStartRecord, RepositoryStorageError>;
};
