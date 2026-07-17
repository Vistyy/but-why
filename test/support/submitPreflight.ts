import { Effect } from "effect";

import type { LocalSubmitPreflight } from "../../src/localSubmit/submitPreflight.js";

const unexpected = (method: string): never => {
  throw new Error(`Unexpected LocalSubmitPreflight.${method} call`);
};

export const fakeSubmitPreflight = (
  overrides: Partial<LocalSubmitPreflight> = {},
): LocalSubmitPreflight => ({
  taskPrefix: "BY",
  resolveTaskId: (taskId) => ({ ok: true, taskId }),
  submitTask: () => unexpected("submitTask"),
  createValidationWorkspaceForValidationRun: () =>
    Effect.die(new Error("Unexpected LocalSubmitPreflight.createValidationWorkspace call")),
  ...overrides,
});
