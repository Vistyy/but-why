import type { TaskReviewRecord } from "../../../task/review/taskReview.js";

export const taskReviewView = (review: TaskReviewRecord, proposalCurrent?: boolean) => ({
  id: review.id,
  taskId: review.taskId,
  state: review.state,
  outcome: review.outcome,
  proposal: review.proposal,
  proposalCurrent: proposalCurrent ?? null,
  dependencyEvidence: review.dependencyEvidence,
  policy: review.policy,
  reviewBase: { ref: review.baseRef, commit: review.baseCommit },
  workspace: { path: review.workspacePath, cleanup: review.workspaceCleanup },
  findings: review.findings,
  findingCount: review.findings.length,
  toolingFailure: review.toolingFailure,
  abandonReason: review.abandonReason,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
});
