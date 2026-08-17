import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const expectedSnapshotWorkspacePath = (
  mainCheckoutRoot: string,
  validationRunId: number,
): string => expectedDisposableWorkspacePath(mainCheckoutRoot, String(validationRunId));
