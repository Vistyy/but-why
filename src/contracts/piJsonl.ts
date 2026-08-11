import { Option, Schema } from "effect";

import type { TokenUsage } from "./tokenUsage.js";

const jsonObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

const sessionMarkerSchema = Schema.Struct({
  type: Schema.Literal("session"),
});

const sessionIdentitySchema = Schema.Struct({
  type: Schema.Literal("session"),
  id: Schema.String,
});

const sessionHeaderSchema = Schema.extend(
  Schema.Struct({
    type: Schema.Literal("session"),
    id: Schema.String,
    cwd: Schema.String,
  }),
  jsonObjectSchema,
);

const assistantMessageEndSchema = Schema.Struct({
  type: Schema.Literal("message_end"),
  message: Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.Unknown,
    usage: Schema.optional(Schema.Unknown),
  }),
});

const textContentSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const tokenCountSchema = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
);

const piMessageUsageSchema = Schema.Struct({
  input: tokenCountSchema,
  output: tokenCountSchema,
  cacheRead: tokenCountSchema,
  cacheWrite: tokenCountSchema,
  totalTokens: Schema.optional(tokenCountSchema),
});

export type PiSessionHeader = Schema.Schema.Type<typeof sessionHeaderSchema>;

export type PiAssistantMessageEnd = Schema.Schema.Type<typeof assistantMessageEndSchema>;

const decodeJsonObject = Schema.decodeUnknownSync(Schema.parseJson(jsonObjectSchema));
const decodeSessionMarker = Schema.decodeUnknownOption(sessionMarkerSchema);
const decodeSessionIdentity = Schema.decodeUnknownOption(sessionIdentitySchema);
const decodeSessionHeaderValue = Schema.decodeUnknownOption(sessionHeaderSchema);
const decodeAssistantMessageEndValue = Schema.decodeUnknownOption(assistantMessageEndSchema);
const decodeContent = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeTextContent = Schema.decodeUnknownOption(textContentSchema);
const decodeMessageUsage = Schema.decodeUnknownOption(piMessageUsageSchema);

export const decodePiJsonlObject = (line: string): Readonly<Record<string, unknown>> =>
  decodeJsonObject(line);

export const isPiSessionRecord = (value: unknown): boolean =>
  Option.isSome(decodeSessionMarker(value));

export const decodePiSessionIdentity = (value: unknown): string | undefined =>
  Option.getOrUndefined(decodeSessionIdentity(value))?.id;

export const decodePiSessionHeader = (value: unknown): PiSessionHeader | undefined =>
  Option.getOrUndefined(decodeSessionHeaderValue(value));

export const decodePiAssistantMessageEnd = (value: unknown): PiAssistantMessageEnd | undefined =>
  Option.getOrUndefined(decodeAssistantMessageEndValue(value));

export const decodePiAssistantText = (content: unknown): string => {
  const parts = Option.getOrUndefined(decodeContent(content));
  if (parts === undefined) return "";
  return parts.map((part) => Option.getOrUndefined(decodeTextContent(part))?.text ?? "").join("");
};

export const decodePiMessageUsage = (value: unknown): TokenUsage | undefined => {
  const usage = Option.getOrUndefined(decodeMessageUsage(value));
  if (usage === undefined) return undefined;
  return {
    inputTokens: usage.input + usage.cacheWrite,
    cachedInputTokens: usage.cacheRead,
    outputTokens: usage.output,
    totalTokens:
      usage.totalTokens ?? usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
  };
};
