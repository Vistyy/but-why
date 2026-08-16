import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { ChangePrepareFailure } from "./change.js";
import type {
  ProvisionChangeWorktreeFailure,
  ProvisionChangeWorktreeResult,
  RollbackProvisionedWorktreeResult,
} from "./changeStartGitOperations.js";
import type { ChangeStartRecord, CreateChangeStartInput } from "./changeStartStore.js";

export type ChangeStartCreationResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "change_start_conflict" }
  | (ProvisionChangeWorktreeFailure & { readonly change: ChangeStartRecord });

export type ChangeStartProvisioner = (change: ChangeStartRecord) => ProvisionChangeWorktreeResult;

export type ChangeStartProvisionRollback = (
  change: ChangeStartRecord,
) => RollbackProvisionedWorktreeResult;

export const recoverProvisionedChangeCreation = <CreationFailure>(input: {
  readonly create: (
    provision?: ChangeStartProvisioner,
  ) => Effect.Effect<ChangeStartCreationResult | CreationFailure, RepositoryStorageError>;
  readonly getById: ChangeStartPersistence["getById"];
  readonly provision?: ChangeStartProvisioner;
  readonly rollback?: ChangeStartProvisionRollback;
}): Effect.Effect<ChangeStartCreationResult | CreationFailure, RepositoryStorageError> => {
  let provisionedChange: ChangeStartRecord | undefined;
  const trackedProvision: ChangeStartProvisioner | undefined =
    input.provision === undefined
      ? undefined
      : (change) => {
          const result = input.provision?.(change) ?? { ok: true as const };
          if (result.ok) provisionedChange = change;
          return result;
        };
  return input.create(trackedProvision).pipe(
    Effect.catchAll((creationError) => {
      const expected = provisionedChange;
      if (expected === undefined || input.rollback === undefined) return Effect.fail(creationError);
      return input.getById(expected.id).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.fail(creationError),
          onSuccess: (committed) => {
            if (committed !== undefined) {
              return sameResourceOwnership(expected, committed)
                ? Effect.succeed({ ok: true as const, change: committed })
                : Effect.fail(creationError);
            }
            input.rollback?.(expected);
            return Effect.fail(creationError);
          },
        }),
      );
    }),
  );
};

const sameResourceOwnership = (expected: ChangeStartRecord, actual: ChangeStartRecord): boolean =>
  actual.repositoryCommonDirectory === expected.repositoryCommonDirectory &&
  actual.branchRef === expected.branchRef &&
  actual.startingCommit === expected.startingCommit &&
  actual.worktreePath === expected.worktreePath;

export type ChangeStartPersistence<CreationFailure = never> = {
  readonly create: (
    input: CreateChangeStartInput,
    provision?: ChangeStartProvisioner,
    rollback?: ChangeStartProvisionRollback,
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
