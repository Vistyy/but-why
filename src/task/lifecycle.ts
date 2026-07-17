export const taskStates = [
  "new",
  "todo",
  "implementing",
  "validating",
  "needs_input",
  "ready",
  "done",
] as const;

export type TaskState = (typeof taskStates)[number];

const taskStateSet = new Set<string>(taskStates);

const validTransitions: ReadonlyMap<TaskState, readonly TaskState[]> = new Map([
  ["new", ["todo"]],
  ["todo", ["implementing"]],
  ["implementing", ["validating"]],
  ["validating", ["needs_input", "ready"]],
  ["needs_input", ["validating"]],
  ["ready", ["done", "needs_input"]],
  ["done", []],
]);

export const isTaskState = (value: string): value is TaskState => taskStateSet.has(value);

export const canTransition = (from: TaskState, to: TaskState): boolean =>
  validTransitions.get(from)?.includes(to) ?? false;
