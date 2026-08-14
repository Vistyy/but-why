import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import {
  openTerminalCleanup as openTerminalCleanupWithFileSystem,
  type TerminalCleanupOperation,
} from "../../src/change/cleanupTerminalChange.js";

export const noOpTerminalCleanupDependencies = {
  artifactLifecycle: {
    removeContent: () => Effect.succeed({ ok: true as const }),
  },
};

export const openTerminalCleanup = (
  ...args: Parameters<typeof openTerminalCleanupWithFileSystem>
): TerminalCleanupOperation => {
  const cleanup = openTerminalCleanupWithFileSystem(...args);
  return (...input) => cleanup(...input).pipe(Effect.provide(NodeFileSystem.layer));
};
