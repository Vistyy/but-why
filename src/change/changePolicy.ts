import { Schema } from "effect";
import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import { checkIdSchema, timeoutSecondsSchema } from "../contracts/repoConfig.js";
import type { SubmitCheckConfig } from "./submit/submitRepoConfig.js";

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
