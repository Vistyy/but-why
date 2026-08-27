import { taskChangeCompletionChangeOperations } from "../../change/composition/loadChangePersistence.js";
import {
  cancelTaskState,
  completeTask,
  getTaskById,
  getTaskContextAndStateById,
  getTaskDependencyFacts,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import type { TaskChangeCancellationOperations } from "../adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import type { TaskChangeCompletionOperations } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import type { TaskChangeStartTaskOperations } from "../adapters/sqlite/sqliteTaskChangeStartPersistence.js";

export const taskChangeCompletionOperations: TaskChangeCompletionOperations = {
  ...taskChangeCompletionChangeOperations,
  completeTask,
  getTaskById,
};

export const taskChangeCancellationOperations: TaskChangeCancellationOperations = {
  cancelTaskState,
  getTaskById,
};

export const taskChangeStartTaskOperations: TaskChangeStartTaskOperations = {
  getTaskContextAndStateById,
  getTaskDependencyFacts,
};
