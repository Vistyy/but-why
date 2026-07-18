import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const readValidationArtifactContent = (
  artifactsRoot: string,
  artifactPath: string,
): Buffer | undefined => {
  try {
    return readFileSync(safeArtifactPath(artifactsRoot, artifactPath));
  } catch {
    return undefined;
  }
};

const safeArtifactPath = (artifactsRoot: string, artifactPath: string): string => {
  const root = resolve(artifactsRoot);
  const resolved = resolve(root, artifactPath);
  const fromRoot = relative(root, resolved);
  if (fromRoot.startsWith("..") || resolve(root, fromRoot) !== resolved) {
    throw new Error("Artifact path is outside the artifact store");
  }
  return resolved;
};
