import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { readRepoRelativeBytes } from "../init/repoConfig.js";
import type { ValidationCopiedFile } from "./candidateValidationRun.js";

export type ResolveCopiedFilesResult =
  | { readonly ok: true; readonly files: readonly ValidationCopiedFile[] }
  | { readonly ok: false; readonly path: string; readonly code: "read_failed" };

export const resolveCopiedFiles = (
  repositoryRoot: string,
  paths: readonly string[],
): ResolveCopiedFilesResult => {
  const files: ValidationCopiedFile[] = [];
  for (const path of [...paths].sort()) {
    try {
      files.push({
        path,
        contentSha256: createHash("sha256")
          .update(readRepoRelativeBytes(resolve(repositoryRoot), path))
          .digest("hex"),
      });
    } catch {
      return { ok: false, path, code: "read_failed" };
    }
  }
  return { ok: true, files };
};
