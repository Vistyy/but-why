import type { PublicTaskId } from "../../task/taskId.js";

export const taskApprovalStateHelp = (taskId: PublicTaskId, state: string): string => {
  switch (state) {
    case "done":
      return "Task is already done.";
    case "cancelled":
      return "Task is already cancelled.";
    default:
      return `Inspect Task ${taskId} with by task show ${taskId}.`;
  }
};
