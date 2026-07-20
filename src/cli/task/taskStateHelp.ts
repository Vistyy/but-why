import type { PublicTaskId } from "../../task/taskId.js";

export const taskApprovalStateHelp = (taskId: PublicTaskId, state: string): string => {
  switch (state) {
    case "implementing":
      return `Inspect the linked Change with by task show ${taskId}, then submit it with by change submit <change-id>.`;
    case "validating":
      return "Wait for validation to finish.";
    case "ready":
      return "Review and merge the pull request.";
    case "done":
      return "Task is already done.";
    default:
      return `Inspect Task ${taskId} with by task show ${taskId}.`;
  }
};
