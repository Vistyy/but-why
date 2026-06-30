export const taskStates = [
  "todo",
  "implementing",
  "validating",
  "needs_input",
  "ready",
  "done",
] as const;

export type TaskState = (typeof taskStates)[number];

export type TaskSummary = {
  readonly id: string;
  readonly title: string;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TaskRecord = TaskSummary & {
  readonly description: string;
};

const taskStateSet = new Set<string>(taskStates);

export const isTaskState = (value: string): value is TaskState => taskStateSet.has(value);
