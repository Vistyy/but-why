import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const resolvePackageAsset = (...segments: readonly string[]): string => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const roots = [
    resolve(moduleDirectory, "../../"),
    resolve(moduleDirectory, "../"),
    resolve(moduleDirectory, ".."),
  ];
  const packageRoot = roots.find((root) => existsSync(join(root, "package.json"))) ?? roots[0];
  if (packageRoot === undefined) throw new Error("No package asset candidates were generated.");
  return join(packageRoot, ...segments);
};
