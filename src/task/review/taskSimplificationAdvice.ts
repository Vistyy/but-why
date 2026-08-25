import { Schema } from "effect";
import { resolvedReviewerPiAgentProfileSchema } from "../../agent/agentProfiles.js";
import type { AgentInvocationRecord } from "../../agent/agentSession/agentSession.js";
import { nonBlankStringSchema } from "../../contracts/agentConfig.js";
import type { TaskReviewToolingFailure } from "./taskReview.js";

const simplificationOptionSchema = Schema.Struct({
  retainedOutcome: nonBlankStringSchema,
  removedComplexity: nonBlankStringSchema,
  lostBehavior: nonBlankStringSchema,
  adverseConsequence: nonBlankStringSchema,
  repositoryEvidence: nonBlankStringSchema,
  materialUncertainty: nonBlankStringSchema,
});

const simplificationAdviceSchema = Schema.Struct({
  practicalCoreOutcome: nonBlankStringSchema,
  options: Schema.Array(simplificationOptionSchema).pipe(Schema.maxItems(2)),
  noSafeSimplificationReason: Schema.NullOr(nonBlankStringSchema),
});

export type TaskSimplificationAdvice = Schema.Schema.Type<typeof simplificationAdviceSchema>;

export const decodeTaskSimplificationAdvice = (value: unknown): TaskSimplificationAdvice => {
  const advice = Schema.decodeUnknownSync(simplificationAdviceSchema, {
    onExcessProperty: "error",
  })(value);
  if ((advice.options.length === 0) !== (advice.noSafeSimplificationReason !== null)) {
    throw new Error(
      "Task Simplification Advice must explain an empty option set or omit that explanation when options exist.",
    );
  }
  return advice;
};

const simplificationAdvicePolicySchema = Schema.Struct({
  profile: resolvedReviewerPiAgentProfileSchema,
  builtInInstructions: nonBlankStringSchema,
});

export type TaskSimplificationAdvicePolicy = Schema.Schema.Type<
  typeof simplificationAdvicePolicySchema
>;

export const decodeTaskSimplificationAdvicePolicy = (
  value: unknown,
): TaskSimplificationAdvicePolicy =>
  Schema.decodeUnknownSync(simplificationAdvicePolicySchema, { onExcessProperty: "error" })(value);

type TaskSimplificationAdviceAttemptEvidence = {
  readonly agentSessionId?: number;
  readonly agentInvocations?: readonly AgentInvocationRecord[];
};

export type TaskSimplificationAdviceAttempt =
  | (TaskSimplificationAdviceAttemptEvidence & {
      readonly state: "completed";
      readonly advice: TaskSimplificationAdvice;
      readonly unavailable: null;
      readonly configuration: TaskSimplificationAdvicePolicy;
      readonly agentSessionId: number;
      readonly agentInvocations: readonly [AgentInvocationRecord, ...AgentInvocationRecord[]];
    })
  | (TaskSimplificationAdviceAttemptEvidence & {
      readonly state: "unavailable";
      readonly advice: null;
      readonly unavailable: TaskReviewToolingFailure;
      readonly configuration: TaskSimplificationAdvicePolicy | null;
    });
