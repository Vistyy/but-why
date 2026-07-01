import {
  exampleTaskId,
  expectedTaskIdFormat,
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
      readonly expectedFormat: string;
      readonly help: string;
    };

export const resolveRepoTaskId = (
  context: RepoLocalContext,
  taskId: PublicTaskId,
): RepoTaskIdResolution => {
  if (!hasPublicTaskIdShape(taskId) || !isPublicTaskIdForPrefix(taskId, context.taskPrefix)) {
    return {
      ok: false,
      expectedFormat: expectedTaskIdFormat(context.taskPrefix),
      help: `Use a public Task ID such as ${exampleTaskId(context.taskPrefix)}.`,
    };
  }

  return { ok: true, taskId };
};
