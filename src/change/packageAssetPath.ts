import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const resolvePackageAsset = (...segments: readonly string[]): string => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "../../", ...segments),
    resolve(moduleDirectory, "../", ...segments),
  ];
  const fallback = candidates[0];
  if (fallback === undefined) throw new Error("No package asset candidates were generated.");
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
};
