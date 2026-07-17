import type { TaskState } from "../../task/lifecycle.js";
import type { PublicTaskId } from "../../task/taskId.js";

export const taskApprovalStateHelp = (taskId: PublicTaskId, state: string): string => {
  switch (state) {
    case "implementing":
      return `Continue implementation, then run by submit ${taskId}.`;
    case "validating":
      return "Wait for validation to finish.";
    case "needs_input":
      return `Address the Findings, then run by submit ${taskId}.`;
    case "ready":
      return "Review and merge the pull request.";
    case "done":
      return "Task is already done.";
    default:
      return `Inspect Task ${taskId} with by task show ${taskId}.`;
  }
};

const taskStartStateHelp = {
  new: (taskId: PublicTaskId) => `Approve the Task first with by task approve ${taskId}.`,
  todo: () => "Run the Task Start command again.",
  implementing: () => "Use the existing Task Start binding or inspect the Task state.",
  validating: () => "Wait for validation to finish.",
  needs_input: (taskId: PublicTaskId) =>
    `Address findings or add Task Context, then run by submit ${taskId}.`,
  ready: () => "Review and merge the pull request.",
  done: () => "Task is already done.",
} satisfies Record<TaskState, (taskId: PublicTaskId) => string>;

export const taskStartStateHelpFor = (taskId: PublicTaskId, state: TaskState): string =>
  taskStartStateHelp[state](taskId);
