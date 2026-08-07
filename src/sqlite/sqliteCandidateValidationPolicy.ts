export const encodeSqliteCandidateValidationPolicy = <T>(policy: T): string =>
  JSON.stringify(policy);
