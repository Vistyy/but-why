import { Effect } from "effect";
import type { ChangeAuthorityPort, ChangeReadPort } from "../change/changePorts.js";
import type { ActiveValidationRunPort } from "../change/validation/changeValidationPorts.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskContext } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type { TaskChangeLinkPort } from "./taskChangePorts.js";

export type TaskChangeActivity = "blocked" | "validating" | "ready" | "implementing";

export type TaskChangeProjection = {
  readonly id: string;
  readonly activity?: TaskChangeActivity;
};

type TaskChangeInspectionDependencies = {
  readonly links: Pick<TaskChangeLinkPort, "getByTaskId">;
  readonly changes: Pick<ChangeReadPort, "getChangeById">;
  readonly authority: Pick<ChangeAuthorityPort, "getCurrentPassingEvidence">;
  readonly activeValidation: Pick<ActiveValidationRunPort, "getActiveForChange">;
};

type TaskContextInspectionDependencies = {
  readonly tasks: Pick<TaskPersistence, "getTaskContextById">;
  readonly links: Pick<TaskChangeLinkPort, "getByTaskId">;
  readonly authority: Pick<ChangeAuthorityPort, "listImplementationBlockers">;
};

export type TaskContextInspectionUseCases = {
  readonly getTaskContextById: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskContext | undefined, RepositoryStorageError>;
};

export const queryTaskContext = (
  dependencies: TaskContextInspectionDependencies,
  taskId: PublicTaskId,
): Effect.Effect<TaskContext | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const context = yield* dependencies.tasks.getTaskContextById(taskId);
    if (context === undefined) return undefined;
    const link = yield* dependencies.links.getByTaskId(taskId);
    if (link === undefined) return context;
    const history = yield* dependencies.authority.listImplementationBlockers(link.changeId);
    if (history === undefined || history.resolutions.length === 0) return context;
    return { ...context, resolutions: history.resolutions.map((resolution) => resolution.content) };
  });

export const queryTaskChangeProjection = (
  dependencies: TaskChangeInspectionDependencies,
  taskId: string,
): Effect.Effect<TaskChangeProjection | null, RepositoryStorageError> =>
  Effect.gen(function* () {
    const link = yield* dependencies.links.getByTaskId(taskId);
    if (link === undefined) return null;
    const change = yield* dependencies.changes.getChangeById(link.changeId);
    if (change === undefined) return null;
    if (change.acceptanceContext === null) {
      return yield* Effect.fail(
        new RepositoryPersistedDataInvalid({
          operationName: "read Task Change projection",
          cause: new Error("Linked Change has no Acceptance Context"),
        }),
      );
    }
    if (change.state === "closed") return { id: change.id };
    if (change.activeBlocker !== null) return { id: change.id, activity: "blocked" };
    if ((yield* dependencies.activeValidation.getActiveForChange(change.id)) !== undefined) {
      return { id: change.id, activity: "validating" };
    }
    const evidence = yield* dependencies.authority.getCurrentPassingEvidence(change.id);
    return {
      id: change.id,
      activity: evidence === undefined ? "implementing" : "ready",
    };
  });
