import { Effect } from "effect";
import type { ChangeAuthorityPort, ChangeReadPort } from "../change/changePorts.js";
import type { ActiveValidationRunPort } from "../change/validation/changeValidationPorts.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
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

export const queryTaskChangeProjection = (
  dependencies: TaskChangeInspectionDependencies,
  taskId: string,
): Effect.Effect<TaskChangeProjection | null, RepositoryStorageError> =>
  Effect.gen(function* () {
    const link = yield* dependencies.links.getByTaskId(taskId);
    if (link === undefined) return null;
    const change = yield* dependencies.changes.getChangeById(link.changeId);
    if (change === undefined) return null;
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
