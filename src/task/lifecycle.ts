export const taskStates = [
  "new",
  "todo",
  "implementing",
  "validating",
  "ready",
  "done",
  "cancelled",
] as const;

export type TaskState = (typeof taskStates)[number];

const taskStateSet = new Set<string>(taskStates);

const validTransitions: ReadonlyMap<TaskState, readonly TaskState[]> = new Map([
  ["new", ["todo"]],
  ["todo", ["implementing"]],
  ["implementing", ["validating"]],
  ["validating", ["implementing", "ready"]],
  ["ready", ["validating", "done"]],
  ["done", []],
  ["cancelled", []],
]);

export const isTaskState = (value: string): value is TaskState => taskStateSet.has(value);

export const canTransition = (from: TaskState, to: TaskState): boolean =>
  validTransitions.get(from)?.includes(to) ?? false;
