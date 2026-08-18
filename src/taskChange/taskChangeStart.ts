import { Effect } from "effect";

import {
  type ChangeStartResult,
  prepareExistingChange,
  startChange,
} from "../change/changeLifecycle.js";
import type { ChangeStartGitOperations } from "../change/changeStartGitOperations.js";
import type { ChangeStartPersistence } from "../change/changeStartPersistence.js";
import type {
  ChangeReviewerConfiguration,
  ChangeStartRecord,
  CreateChangeStartInput,
} from "../change/changeStartStore.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { RepositoryPreparationEffectExecutor } from "../repositoryPreparation/runRepositoryPreparation.js";
import { parseRemoteChangeBaseRef } from "../submissionEnvironment/remoteChangeBaseRef.js";

type TaskState = "new" | "todo" | "done" | "cancelled";
type TaskDependencyFact = {
  readonly id: string;
  readonly title: string;
  readonly state: TaskState;
};

export type TaskChangeStartEligibilityError =
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | {
      readonly ok: false;
      readonly code: "task_dependencies_unsatisfied";
      readonly blockedBy: readonly TaskDependencyFact[];
    };

export type TaskChangeStartPreparation =
  | {
      readonly ok: true;
      readonly existing: ChangeStartRecord | undefined;
    }
  | TaskChangeStartEligibilityError;

export type TaskChangeStartCreationInput = CreateChangeStartInput & {
  readonly taskId: string;
};

export type TaskChangeStartCreateInput = CreateChangeStartInput & {
  readonly taskId?: string;
};

export type TaskChangeStartPersistence = {
  readonly create: (
    input: TaskChangeStartCreateInput,
  ) => ReturnType<ChangeStartPersistence<TaskChangeStartEligibilityError>["create"]>;
  readonly prepareTask: (
    taskId: string,
  ) => Effect.Effect<TaskChangeStartPreparation, RepositoryStorageError>;
  readonly createLinked: (
    input: TaskChangeStartCreationInput,
  ) => ReturnType<ChangeStartPersistence<TaskChangeStartEligibilityError>["create"]>;
  readonly getById: ChangeStartPersistence["getById"];
  readonly recordPrepareOutcome: ChangeStartPersistence["recordPrepareOutcome"];
};

export type TaskChangeStartInput = {
  readonly taskId: string;
  readonly baseBranch?: string;
  readonly now: string;
};

export type TaskChangeStartResult =
  | (ChangeStartResult & { readonly taskId: string })
  | TaskChangeStartEligibilityError
  | {
      readonly ok: false;
      readonly code: "requested_base_conflict";
      readonly requestedBaseBranch: string;
      readonly recordedBaseBranch?: string;
    };

export const startTaskChange = (
  store: TaskChangeStartPersistence,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  input: TaskChangeStartInput,
  resolveReviewerConfiguration: (
    startingCommit: string,
  ) => Effect.Effect<
    | { readonly ok: true; readonly configuration: ChangeReviewerConfiguration }
    | { readonly ok: false; readonly message: string }
  >,
): Effect.Effect<TaskChangeStartResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const prepared = yield* store.prepareTask(input.taskId);
    if (!prepared.ok) return prepared;
    if (prepared.existing !== undefined) {
      const recordedBaseBranch = parseRemoteChangeBaseRef(prepared.existing.baseRef)?.branchName;
      if (input.baseBranch !== undefined && input.baseBranch !== recordedBaseBranch) {
        return {
          ok: false as const,
          code: "requested_base_conflict" as const,
          requestedBaseBranch: input.baseBranch,
          ...(recordedBaseBranch === undefined ? {} : { recordedBaseBranch }),
        };
      }
      const provisioned = git.provisionWorktree(prepared.existing, true);
      if (!provisioned.ok) {
        return { ...provisioned, change: prepared.existing, taskId: input.taskId };
      }
      const recovered = yield* prepareExistingChange(store, executor, prepared.existing, input.now);
      return { ...recovered, taskId: input.taskId };
    }

    const ownerStore: ChangeStartPersistence<TaskChangeStartEligibilityError> = {
      create: (createInput) =>
        store.createLinked({
          ...createInput,
          taskId: input.taskId,
        }),
      getById: store.getById,
      recordPrepareOutcome: store.recordPrepareOutcome,
    };
    const started = yield* startChange(ownerStore, git, executor, {
      ...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
      resolveReviewerConfiguration,
      now: input.now,
    });
    return { ...started, taskId: input.taskId };
  });
