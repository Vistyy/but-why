import type { TaskState } from "../task/lifecycle.js";

export type TaskCompletionDecision =
  | { readonly ok: true; readonly state: "todo" | "done" }
  | { readonly ok: false; readonly code: "task_completion_rejected"; readonly state: TaskState };

export const decideTaskCompletion = (state: TaskState): TaskCompletionDecision =>
  state === "todo" || state === "done"
    ? { ok: true, state }
    : { ok: false, code: "task_completion_rejected", state };

export const canCancelLinkedTask = (state: TaskState): boolean => state !== "done";
