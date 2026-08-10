import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";

export const validationTempRefName = (validationRunId: string): string =>
  `refs/but-why/validation-runs/${validationRunId}/validation`;

export const expectedValidationWorkspacePath = (repoRoot: string, tempRefName: string): string =>
  expectedDisposableWorkspacePath(repoRoot, tempRefName);
