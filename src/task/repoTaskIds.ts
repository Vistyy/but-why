import type { LocalRepositoryContext } from "../repositoryRuntime/repositoryContext.js";
import { hasPublicTaskIdShape, type PublicTaskId } from "./taskId.js";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isPublicTaskIdForPrefix = (taskId: string, idPrefix: string): boolean =>
  new RegExp(`^${escapeRegExp(idPrefix)}-[1-9][0-9]*$`).test(taskId);

const exampleTaskId = (idPrefix: string): string => `${idPrefix}-1`;

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
  context: LocalRepositoryContext,
  taskId: PublicTaskId,
): RepoTaskIdResolution => {
  if (hasPublicTaskIdShape(taskId) && isPublicTaskIdForPrefix(taskId, context.idPrefix)) {
    return { ok: true, taskId };
  }

  return {
    ok: false,
    code: "remote_tasks_not_supported",
    taskId,
    help: `Use a repo-local Task ID such as ${exampleTaskId(context.idPrefix)}. Remote Task authorities are not supported yet.`,
  };
};
