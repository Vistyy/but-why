import { rmSync } from "node:fs";
import { relative, resolve } from "node:path";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  ArtifactContentRemovalResult,
  ArtifactLifecycleOwner,
} from "../cleanupTerminalChange.js";
import type { ChangeValidationPersistence } from "../validation/changeValidationPersistence.js";

export const openArtifactLifecycle = (input: {
  readonly persistence: Pick<
    ChangeValidationPersistence,
    "listCandidatesForChange" | "listRunsForCandidate"
  >;
  readonly artifactsRoot: string;
}): ArtifactLifecycleOwner => ({
  removeContent: (changeId) => removeChangeArtifactContent(input, changeId),
});

const removeChangeArtifactContent = (
  dependencies: {
    readonly persistence: Pick<
      ChangeValidationPersistence,
      "listCandidatesForChange" | "listRunsForCandidate"
    >;
    readonly artifactsRoot: string;
  },
  changeId: string,
): Effect.Effect<ArtifactContentRemovalResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const candidates = yield* dependencies.persistence.listCandidatesForChange(changeId);
    const runs = yield* Effect.forEach(candidates, (candidate) =>
      dependencies.persistence.listRunsForCandidate(candidate.id),
    );
    let removed = true;
    for (const run of runs.flat()) {
      if (!removeValidationRunContent(dependencies.artifactsRoot, run.id)) removed = false;
    }
    return removed ? { ok: true } : { ok: false };
  });

const removeValidationRunContent = (artifactsRoot: string, validationRunId: string): boolean => {
  try {
    const target = safeArtifactDirectory(artifactsRoot, validationRunId);
    rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};

const safeArtifactDirectory = (artifactsRoot: string, validationRunId: string): string => {
  const root = resolve(artifactsRoot);
  const resolved = resolve(root, validationRunId);
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
