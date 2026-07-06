import {
  exampleTaskId,
  isPublicTaskIdForPrefix,
  type RepoLocalContext,
} from "../init/repoContext.js";
import { hasPublicTaskIdShape, type PublicTaskId } from "./taskId.js";

export type RepoTaskIdResolution =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly code: "remote_tasks_not_supported";
      readonly taskId: PublicTaskId;
      readonly help: string;
    };

export const resolveRepoTaskId = (
  context: RepoLocalContext,
  taskId: PublicTaskId,
): RepoTaskIdResolution => {
  if (hasPublicTaskIdShape(taskId) && isPublicTaskIdForPrefix(taskId, context.taskPrefix)) {
    return { ok: true, taskId };
  }

  return {
    ok: false,
    code: "remote_tasks_not_supported",
    taskId,
    help: `Use a repo-local Task ID such as ${exampleTaskId(context.taskPrefix)}. Remote Task authorities are not supported yet.`,
  };
};
