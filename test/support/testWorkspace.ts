import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Effect } from "effect";
import { onTestFinished } from "vitest";

export const acquireTestWorkspace = (): string => mkdtempSync(join(tmpdir(), "but-why-test-"));

const removeOwnedSiblings = (workspace: string): void => {
  try {
    const parent = dirname(workspace);
    const base = basename(workspace);
    const prefix = `${base}-`;
    let entries: readonly string[];
    try {
      entries = readdirSync(parent);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const siblingPath = join(parent, entry);
      try {
        rmSync(siblingPath, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
};

export const releaseTestWorkspace = (workspace: string): void => {
  removeOwnedSiblings(workspace);
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {}
  removeOwnedSiblings(workspace);
};

export const testWorkspace = Effect.acquireRelease(Effect.sync(acquireTestWorkspace), (workspace) =>
  Effect.sync(() => releaseTestWorkspace(workspace)),
);

export const createTestWorkspace = (): string => {
  const workspace = acquireTestWorkspace();
  onTestFinished(() => releaseTestWorkspace(workspace));
  return workspace;
};
