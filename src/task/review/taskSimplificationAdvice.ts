import { Schema } from "effect";
import { resolvedReviewerPiAgentProfileSchema } from "../../agent/agentProfiles.js";
import type { AgentInvocationRecord } from "../../agent/agentSession/agentSession.js";
import { nonBlankStringSchema } from "../../contracts/agentConfig.js";
import type { TaskReviewToolingFailure } from "./taskReview.js";

export type TaskSimplificationAdvice = string;

export const decodeTaskSimplificationAdvice = (value: unknown): TaskSimplificationAdvice =>
  Schema.decodeUnknownSync(nonBlankStringSchema)(value);

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
