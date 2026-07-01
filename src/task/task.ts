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
  readonly branch: string | null;
  readonly latestRun: string | null;
  readonly commentCount: number;
};

export type TaskContext = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly comments: readonly string[];
};

export const submittableTaskStates = [
  "implementing",
  "needs_input",
] as const satisfies readonly TaskState[];

const taskStateSet = new Set<string>(taskStates);
const submittableTaskStateSet = new Set<TaskState>(submittableTaskStates);

export const isTaskState = (value: string): value is TaskState => taskStateSet.has(value);

export const isSubmittableTaskState = (value: TaskState): boolean =>
  submittableTaskStateSet.has(value);
