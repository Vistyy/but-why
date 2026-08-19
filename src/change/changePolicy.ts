import { Schema } from "effect";
import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import { checkIdSchema, timeoutSecondsSchema } from "../contracts/repoConfig.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReview/acceptanceReviewConfig.js";
import type { ChangePrepareDefinition } from "./change.js";
import type { SpecialistReviewPolicy } from "./specialistReview/specialistReviewConfig.js";
import type { SubmitCheckConfig } from "./submit/submitRepoConfig.js";

export type ChangeReviewerConfiguration = {
  readonly acceptanceReview: AcceptanceReviewPolicy | null;
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
  readonly agentEnvironment?: AgentEnvironmentCommand;
};

export type ChangePolicy = {
  readonly reviewerConfiguration: ChangeReviewerConfiguration;
  readonly prepare: ChangePrepareDefinition | null;
  readonly checks: readonly SubmitCheckConfig[];
};

const changeChecksSchema = Schema.Array(
  Schema.Struct({
    id: checkIdSchema,
    command: nonBlankStringSchema,
    timeoutSeconds: timeoutSecondsSchema,
  }),
).pipe(
  Schema.filter((checks) => new Set(checks.map((check) => check.id)).size === checks.length, {
    message: () => "Validation Check IDs must be unique",
  }),
);

const decodeChecks = Schema.decodeUnknownSync(changeChecksSchema, { onExcessProperty: "error" });

const decodeChangeChecks = (value: unknown): readonly SubmitCheckConfig[] => decodeChecks(value);

export const decodeSqliteChangeChecks = (source: string): readonly SubmitCheckConfig[] =>
  decodeChangeChecks(JSON.parse(source) as unknown);

export const encodeSqliteChangeChecks = (checks: readonly SubmitCheckConfig[]): string =>
  JSON.stringify(decodeChangeChecks(checks));
