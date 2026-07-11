import { Schema } from "effect";

export const nonBlankStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0, {
    identifier: "non-empty string",
    message: () => "Expected a non-empty string",
  }),
);

export const configNameSchema = Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9._-]*$/u));

const thinkingSchema = Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh");

const piAgentConfigSchema = Schema.Struct({
  agentRuntime: Schema.Literal("pi"),
  agentModel: Schema.optional(nonBlankStringSchema),
  thinking: Schema.optional(thinkingSchema),
});

const nonPiRuntimeSchema = nonBlankStringSchema.pipe(
  Schema.filter((value) => value !== "pi", {
    identifier: "non-Pi agent runtime",
    message: () => 'Expected an agent runtime other than "pi"',
  }),
);

const nonPiAgentConfigSchema = Schema.Struct({
  agentRuntime: nonPiRuntimeSchema,
  agentModel: Schema.optional(nonBlankStringSchema),
  thinking: Schema.optional(nonBlankStringSchema),
});

export const agentProfileSchema = Schema.Union(piAgentConfigSchema, nonPiAgentConfigSchema);

export type AgentProfileConfig = Schema.Schema.Type<typeof agentProfileSchema>;
