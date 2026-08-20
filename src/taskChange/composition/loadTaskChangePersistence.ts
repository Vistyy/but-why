import {
  cancelTaskState,
  completeTask,
  editTaskDependencies,
  getTaskById,
  getTaskDependenciesForChangeStart,
  getTaskForChangeStart,
  renameTask,
  reviseTask,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import { normalizeTaskTitle } from "../../task/taskTitle.js";
import type { TaskChangeTaskOperations } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import type { TaskChangeStartTaskOperations } from "../adapters/sqlite/sqliteTaskChangeStartPersistence.js";

export const taskChangeTaskOperations: TaskChangeTaskOperations = {
  cancelTaskState,
  completeTask,
  editTaskDependencies,
  getTaskById,
  normalizeTaskTitle,
  renameTask,
  reviseTask,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
};

export const taskChangeStartTaskOperations: TaskChangeStartTaskOperations = {
  getTaskDependenciesForChangeStart,
  getTaskForChangeStart,
};
