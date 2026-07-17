import type { CandidateValidationPolicySnapshot } from "../candidateValidation/candidateValidationRunStore.js";

export const encodeSqliteCandidateValidationPolicy = (
  policy: CandidateValidationPolicySnapshot,
): string => JSON.stringify(policy);
