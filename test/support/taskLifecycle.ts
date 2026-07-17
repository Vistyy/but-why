import { canTransition, taskStates, type TaskState } from "../../src/task/lifecycle.js";

export const taskStateTransitionPath = (target: TaskState): readonly TaskState[] => {
  const queue: { readonly state: TaskState; readonly path: readonly TaskState[] }[] = [
    { state: "new", path: [] },
  ];
  const seen = new Set<TaskState>(["new"]);

  for (const current of queue) {
    if (current.state === target) {
      return current.path;
    }

    for (const nextState of taskStates) {
      if (!canTransition(current.state, nextState) || seen.has(nextState)) {
        continue;
      }

      seen.add(nextState);
      queue.push({ state: nextState, path: [...current.path, nextState] });
    }
  }

  throw new Error(`No transition path to ${target}`);
};
