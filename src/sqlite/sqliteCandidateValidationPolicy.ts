import { Schema } from "effect";

import {
  type CandidateValidationPolicySnapshot,
  candidateValidationPolicySnapshotSchema,
} from "../change/candidateValidation/candidateValidationPolicySnapshot.js";

export const encodeSqliteCandidateValidationPolicy = (
  policy: CandidateValidationPolicySnapshot,
): string => JSON.stringify(policy);

const decodePolicySnapshot = Schema.decodeUnknownSync(
  Schema.parseJson(candidateValidationPolicySnapshotSchema),
  { onExcessProperty: "error" },
);

export const decodeSqliteCandidateValidationPolicy = (
  value: string,
): CandidateValidationPolicySnapshot => decodePolicySnapshot(value);
