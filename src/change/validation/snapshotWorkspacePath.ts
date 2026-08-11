import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const expectedSnapshotWorkspacePath = (
  mainCheckoutRoot: string,
  validationRunId: string,
): string => expectedDisposableWorkspacePath(mainCheckoutRoot, validationRunId);
