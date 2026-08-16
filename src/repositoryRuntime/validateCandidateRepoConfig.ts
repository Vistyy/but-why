import { join } from "node:path";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import { readRepoConfig } from "../init/adapters/repoConfig.js";

export type CandidateRepoConfigValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly path: string;
      readonly message: string;
      readonly diagnostics: readonly ContractDiagnostic[];
    };

export const validateCandidateRepoConfig = (
  candidateRoot: string,
): CandidateRepoConfigValidationResult => {
  const path = join(candidateRoot, ".but-why", "config.json");
  const result = readRepoConfig(path);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    path: result.error.path ?? path,
    message: result.error.message,
    diagnostics: result.error.diagnostics,
  };
};
