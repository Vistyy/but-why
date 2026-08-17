import { relative, resolve } from "node:path";
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  ArtifactContentRemovalResult,
  ArtifactLifecycleOwner,
} from "../cleanupTerminalChange.js";
import type { ValidationArtifactLifecyclePort } from "../validation/changeValidationPorts.js";

export const openArtifactLifecycle = (input: {
  readonly persistence: Pick<ValidationArtifactLifecyclePort, "listRunIdsForChange">;
  readonly artifactsRoot: string;
}): ArtifactLifecycleOwner<FileSystem.FileSystem> => ({
  removeContent: (changeId) => removeChangeArtifactContent(input, changeId),
});

const removeChangeArtifactContent = (
  dependencies: {
    readonly persistence: Pick<ValidationArtifactLifecyclePort, "listRunIdsForChange">;
    readonly artifactsRoot: string;
  },
  changeId: string,
): Effect.Effect<ArtifactContentRemovalResult, RepositoryStorageError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const runIds = yield* dependencies.persistence.listRunIdsForChange(changeId);
    let removed = true;
    for (const runId of runIds) {
      const result = yield* removeValidationRunContent(
        fileSystem,
        dependencies.artifactsRoot,
        runId,
      );
      if (!result) removed = false;
    }
    return removed ? { ok: true } : { ok: false };
  });

const removeValidationRunContent = (
  fileSystem: FileSystem.FileSystem,
  artifactsRoot: string,
  validationRunId: number,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const target = yield* Effect.try(() => safeArtifactDirectory(artifactsRoot, validationRunId));
    yield* fileSystem.remove(target, { recursive: true, force: true });
    return true;
  }).pipe(Effect.orElseSucceed(() => false));

const safeArtifactDirectory = (artifactsRoot: string, validationRunId: number): string => {
  const root = resolve(artifactsRoot);
  const resolved = resolve(root, String(validationRunId));
  const fromRoot = relative(root, resolved);
  if (
    fromRoot.length === 0 ||
    fromRoot.startsWith("..") ||
    fromRoot.includes("/") ||
    fromRoot.includes("\\") ||
    resolve(root, fromRoot) !== resolved
  ) {
    throw new Error("Artifact content directory is outside the artifact store");
  }
  return resolved;
};
