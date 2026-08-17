import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const taskReviewWorkspaceId = (reviewId: number): string => `task-review-${reviewId}`;

export const expectedTaskReviewWorkspacePath = (
  mainCheckoutRoot: string,
  reviewId: number,
): string => expectedDisposableWorkspacePath(mainCheckoutRoot, taskReviewWorkspaceId(reviewId));
