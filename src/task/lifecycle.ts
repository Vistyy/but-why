export const taskStates = ["new", "todo", "done", "cancelled"] as const;

export type TaskState = (typeof taskStates)[number];

const taskStateSet = new Set<string>(taskStates);

export const isTaskState = (value: string): value is TaskState => taskStateSet.has(value);
