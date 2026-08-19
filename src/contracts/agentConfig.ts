import { Schema } from "effect";

export const nonBlankStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0, {
    identifier: "non-empty string",
    message: () => "Expected a non-empty string",
  }),
);

export const configNameSchema = Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9._-]*$/u));

export const isPackageAgentResource = (source: string): boolean =>
  /^(?:npm|git|github|https?|ssh):/u.test(source);

export const packageAgentResourceSchema = nonBlankStringSchema.pipe(
  Schema.filter(isPackageAgentResource, {
    identifier: "package Agent resource",
    message: () => "Expected a package Agent resource URI",
  }),
);

const thinkingSchema = Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh");

export const agentProfileReferenceSchema = Schema.Struct({
  scope: Schema.Literal("repo", "global"),
  name: configNameSchema,
});

const piRuntimeConfigSchema = Schema.Struct({
  model: Schema.optional(nonBlankStringSchema),
  thinking: Schema.optional(thinkingSchema),
  extensions: Schema.optional(Schema.Array(nonBlankStringSchema)),
  skills: Schema.optional(Schema.Array(nonBlankStringSchema)),
  tools: Schema.optional(Schema.Array(nonBlankStringSchema)),
  contextFileDiscovery: Schema.optional(Schema.Boolean),
});

const piAgentConfigSchema = Schema.Struct({
  agentRuntime: Schema.Literal("pi"),
  runtimeConfig: Schema.optional(piRuntimeConfigSchema),
});

export const agentProfileSchema = piAgentConfigSchema;

export type AgentProfileReference = Schema.Schema.Type<typeof agentProfileReferenceSchema>;
export type PiRuntimeConfig = Schema.Schema.Type<typeof piRuntimeConfigSchema>;
export type PiAgentProfileConfig = Schema.Schema.Type<typeof piAgentConfigSchema>;
