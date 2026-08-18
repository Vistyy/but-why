import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const taskReviewWorkspaceId = (reviewId: number): string => `task-review-${reviewId}`;

export const expectedTaskReviewWorkspacePath = (
  repositoryCommonDirectory: string,
  reviewId: number,
): string =>
  expectedDisposableWorkspacePath(repositoryCommonDirectory, taskReviewWorkspaceId(reviewId));
