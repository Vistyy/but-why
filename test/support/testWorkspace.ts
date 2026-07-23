import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { onTestFinished } from "vitest";

export const acquireTestWorkspace = (): string => mkdtempSync(join(tmpdir(), "but-why-test-"));

export const releaseTestWorkspace = (workspace: string): void => {
  rmSync(workspace, { recursive: true, force: true });
};

export const testWorkspace = Effect.acquireRelease(Effect.sync(acquireTestWorkspace), (workspace) =>
  Effect.sync(() => releaseTestWorkspace(workspace)),
);

export const createTestWorkspace = (): string => {
  const workspace = acquireTestWorkspace();
  onTestFinished(() => releaseTestWorkspace(workspace));
  return workspace;
};
