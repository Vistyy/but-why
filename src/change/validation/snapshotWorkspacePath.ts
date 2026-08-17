import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const snapshotWorkspaceId = (validationRunId: number): string =>
  `validation-run-${validationRunId}`;

export const expectedSnapshotWorkspacePath = (
  mainCheckoutRoot: string,
  validationRunId: number,
): string =>
  expectedDisposableWorkspacePath(mainCheckoutRoot, snapshotWorkspaceId(validationRunId));
