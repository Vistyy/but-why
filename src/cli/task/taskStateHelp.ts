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
