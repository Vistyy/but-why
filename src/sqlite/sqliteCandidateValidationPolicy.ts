import type { CandidateValidationPolicySnapshot } from "../change/candidateValidation/candidateValidationRunStore.js";

export const encodeSqliteCandidateValidationPolicy = (
  policy: CandidateValidationPolicySnapshot,
): string => JSON.stringify(policy);

export const decodeSqliteCandidateValidationPolicy = (
  value: string,
): CandidateValidationPolicySnapshot => JSON.parse(value) as CandidateValidationPolicySnapshot;
