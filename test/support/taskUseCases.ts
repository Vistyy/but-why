import type { TaskUseCases } from "../../src/task/taskUseCases.js";

const unexpected = (method: string): never => {
  throw new Error(`Unexpected TaskUseCases.${method} call`);
};

export const fakeTaskUseCases = (overrides: Partial<TaskUseCases> = {}): TaskUseCases => ({
  taskPrefix: "BY",
  resolveTaskId: (taskId) => ({ ok: true, taskId }),
  createTask: () => unexpected("createTask"),
  replaceTaskDependencies: () => unexpected("replaceTaskDependencies"),
  listTasks: () => unexpected("listTasks"),
  listActionableTasks: () => unexpected("listActionableTasks"),
  getTaskById: () => unexpected("getTaskById"),
  getLatestTaskValidationFindings: () => unexpected("getLatestTaskValidationFindings"),
  listTaskValidationRuns: () => unexpected("listTaskValidationRuns"),
  getTaskContextById: () => unexpected("getTaskContextById"),
  createTaskContextDraft: () => unexpected("createTaskContextDraft"),
  applyTaskContextDraft: () => unexpected("applyTaskContextDraft"),
  approveTask: () => unexpected("approveTask"),
  appendTaskComment: () => unexpected("appendTaskComment"),
  transitionTaskState: () => unexpected("transitionTaskState"),
  ...overrides,
});
