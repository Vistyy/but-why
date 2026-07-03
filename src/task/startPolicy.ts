import type { TaskState } from "./lifecycle.js";

const startEligibleStates = ["todo", "implementing"] as const satisfies readonly TaskState[];

export type StartEligibleState = (typeof startEligibleStates)[number];
export type StartIneligibleState = Exclude<TaskState, StartEligibleState>;

const startEligibleStateSet = new Set<TaskState>(startEligibleStates);

export const canStartFrom = (state: TaskState): state is StartEligibleState =>
  startEligibleStateSet.has(state);
