import { relative, resolve } from "node:path";
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";

export const readValidationArtifactContent = (
  artifactsRoot: string,
  artifactPath: string,
): Effect.Effect<Buffer | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Effect.option(
      Effect.try(() => safeArtifactPath(artifactsRoot, artifactPath)),
    );
    if (path._tag === "None") return undefined;

    return yield* fileSystem.readFile(path.value).pipe(
      Effect.map((content) => Buffer.from(content)),
      Effect.orElseSucceed(() => undefined),
    );
  });

const safeArtifactPath = (artifactsRoot: string, artifactPath: string): string => {
  const root = resolve(artifactsRoot);
  const resolved = resolve(root, artifactPath);
  const fromRoot = relative(root, resolved);
  if (fromRoot.startsWith("..") || resolve(root, fromRoot) !== resolved) {
    throw new Error("Artifact path is outside the artifact store");
  }
  return resolved;
};
