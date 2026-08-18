import { Schema } from "effect";

import { nonBlankStringSchema } from "../../contracts/agentConfig.js";
import { checkIdSchema, timeoutSecondsSchema } from "../../contracts/repoConfig.js";
import { acceptanceContextSnapshotSchema } from "../validationRun/acceptanceContextSnapshot.js";

const prepareSnapshotSchema = Schema.Struct({
  command: nonBlankStringSchema,
  timeoutSeconds: timeoutSecondsSchema,
});

const checkSnapshotSchema = Schema.Struct({
  id: checkIdSchema,
  command: nonBlankStringSchema,
  timeoutSeconds: timeoutSecondsSchema,
});

export const candidateValidationPolicySnapshotSchema = Schema.Struct({
  acceptanceContext: Schema.optional(acceptanceContextSnapshotSchema),
  agentEnvironment: Schema.optional(Schema.Array(nonBlankStringSchema)),
  prepare: Schema.optional(prepareSnapshotSchema),
  checks: Schema.Array(checkSnapshotSchema),
  copyFiles: Schema.Array(nonBlankStringSchema),
}).pipe(
  Schema.filter((policy) => unique(policy.checks.map((check) => check.id)), {
    message: () => "Validation Check IDs must be unique",
  }),
);

export type CandidateValidationPolicySnapshot = Schema.Schema.Type<
  typeof candidateValidationPolicySnapshotSchema
>;

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
