import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const snapshotWorkspaceId = (validationRunId: number): string =>
  `validation-run-${validationRunId}`;

export const expectedSnapshotWorkspacePath = (
  repositoryCommonDirectory: string,
  validationRunId: number,
): string =>
  expectedDisposableWorkspacePath(repositoryCommonDirectory, snapshotWorkspaceId(validationRunId));
