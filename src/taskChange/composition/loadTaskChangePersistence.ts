import { taskChangeCompletionChangeOperations } from "../../change/composition/loadChangePersistence.js";
import {
  cancelTaskState,
  completeTask,
  editTaskDependencies,
  getTaskById,
  getTaskContextAndStateById,
  getTaskDependencyFacts,
  renameTask,
  reviseTask,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import { normalizeTaskTitle } from "../../task/taskTitle.js";
import type { TaskChangeCancellationOperations } from "../adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import type {
  TaskChangeCompletionOperations,
  TaskChangeTaskMutationOperations,
} from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import type { TaskChangeStartTaskOperations } from "../adapters/sqlite/sqliteTaskChangeStartPersistence.js";

export const taskChangeTaskMutationOperations: TaskChangeTaskMutationOperations = {
  editTaskDependencies,
  getTaskById,
  normalizeTaskTitle,
  renameTask,
  reviseTask,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
};

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
