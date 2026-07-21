import { Effect } from "effect";

import type { TaskSummary } from "../../src/task/task.js";
import type { CreateTaskInput } from "../../src/task/taskStore.js";
import type { TaskUseCases } from "../../src/task/taskUseCases.js";

type SyncMethod<F> = F extends (...args: infer A) => Effect.Effect<infer S, unknown, unknown>
  ? (...args: A) => S
  : F;

type SyncTaskUseCases = Omit<
  {
    [K in keyof TaskUseCases]: SyncMethod<TaskUseCases[K]>;
  },
  "createTask"
> & {
  readonly createTask: (input: CreateTaskInput) => TaskSummary;
};

const unexpected = (method: string): never => {
  throw new Error(`Unexpected TaskUseCases.${method} call`);
};

export const fakeTaskUseCases = (overrides: Partial<SyncTaskUseCases> = {}): TaskUseCases => {
  const sync: SyncTaskUseCases = {
    taskPrefix: "BY",
    resolveTaskId: (taskId) => ({ ok: true, taskId }),
    createTask: () => unexpected("createTask"),
    replaceTaskDependencies: () => unexpected("replaceTaskDependencies"),
    listTasks: () => unexpected("listTasks"),
    listActionableTasks: () => unexpected("listActionableTasks"),
    getTaskById: () => unexpected("getTaskById"),
    getTaskForInspection: (taskId) => {
      const supplied = overrides.getTaskForInspection ?? overrides.getTaskById;
      return supplied === undefined ? unexpected("getTaskForInspection") : supplied(taskId);
    },
    getTaskContextById: () => unexpected("getTaskContextById"),
    createTaskContextDraft: () => unexpected("createTaskContextDraft"),
    applyTaskContextDraft: () => unexpected("applyTaskContextDraft"),
    approveTask: () => unexpected("approveTask"),
    appendTaskComment: () => unexpected("appendTaskComment"),
    transitionTaskState: () => unexpected("transitionTaskState"),
    ...overrides,
  };

  return {
    taskPrefix: sync.taskPrefix,
    resolveTaskId: sync.resolveTaskId,
    createTask: (...args) => Effect.succeed({ ok: true, task: sync.createTask(...args) }),
    replaceTaskDependencies: (...args) => Effect.succeed(sync.replaceTaskDependencies(...args)),
    listTasks: (...args) => Effect.succeed(sync.listTasks(...args)),
    listActionableTasks: (...args) => Effect.succeed(sync.listActionableTasks(...args)),
    getTaskById: (...args) => Effect.succeed(sync.getTaskById(...args)),
    getTaskForInspection: (...args) => Effect.succeed(sync.getTaskForInspection(...args)),
    getTaskContextById: (...args) => Effect.succeed(sync.getTaskContextById(...args)),
    createTaskContextDraft: (...args) => Effect.succeed(sync.createTaskContextDraft(...args)),
    applyTaskContextDraft: (...args) => Effect.succeed(sync.applyTaskContextDraft(...args)),
    approveTask: (...args) => Effect.succeed(sync.approveTask(...args)),
    appendTaskComment: (...args) => Effect.succeed(sync.appendTaskComment(...args)),
    transitionTaskState: (...args) => Effect.succeed(sync.transitionTaskState(...args)),
  };
};
