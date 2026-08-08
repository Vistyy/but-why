import * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";

// Migration-owned stable repair predicate for the current Validation Policy
// Snapshot representation at migration 0025. This copy is frozen here so later
// schema evolution cannot broaden the historical migration.
const acceptanceContextSnapshotSchema = Schema.Struct({
  version: Schema.Literal(1),
  title: Schema.String,
  description: Schema.String,
  comments: Schema.optional(Schema.Array(Schema.String)),
  resolutions: Schema.optional(Schema.Array(Schema.String)),
});

const piRuntimeConfigSnapshotSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh")),
  extensions: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  tools: Schema.optional(Schema.Array(Schema.String)),
  contextFileDiscovery: Schema.optional(Schema.Boolean),
});

const piAgentProfileConfigSnapshotSchema = Schema.Struct({
  agentRuntime: Schema.Literal("pi"),
  runtimeConfig: Schema.optional(piRuntimeConfigSnapshotSchema),
});

const resolvedPiAgentProfileSnapshotSchema = Schema.Struct({
  agentProfile: Schema.String,
  scope: Schema.Literal("repo", "global"),
  profile: piAgentProfileConfigSnapshotSchema,
});

const prepareSnapshotSchema = Schema.Struct({
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const checkSnapshotSchema = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const acceptanceReviewPolicySnapshotSchema = Schema.Struct({
  instructions: Schema.String,
  instructionsSource: Schema.Literal("repo", "global", "built_in"),
  profile: resolvedPiAgentProfileSnapshotSchema,
});

const specialistReviewPolicySnapshotSchema = Schema.Struct({
  id: Schema.String,
  instructions: Schema.String,
  instructionsSource: Schema.Literal("repo", "global"),
  profile: resolvedPiAgentProfileSnapshotSchema,
});

const candidateValidationPolicySnapshotSchema = Schema.Struct({
  acceptanceContext: Schema.optional(acceptanceContextSnapshotSchema),
  agentEnvironment: Schema.optional(Schema.Array(Schema.String)),
  prepare: Schema.optional(prepareSnapshotSchema),
  checks: Schema.Array(checkSnapshotSchema),
  copyFiles: Schema.Array(Schema.String),
  acceptanceReview: Schema.optional(acceptanceReviewPolicySnapshotSchema),
  specialistReviews: Schema.optional(Schema.Array(specialistReviewPolicySnapshotSchema)),
});

const decodePolicySnapshot = Schema.decodeUnknownSync(
  Schema.parseJson(candidateValidationPolicySnapshotSchema),
  { onExcessProperty: "error" },
);

type JsonObject = { readonly [key: string]: unknown };

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const reorderKeys = (value: JsonObject, order: readonly string[]): Record<string, unknown> => {
  // A null-prototype object keeps an own parsed "__proto__" field as data instead
  // of invoking the prototype setter, so no Snapshot content is ever discarded.
  const result: Record<string, unknown> = Object.create(null);
  for (const key of order) {
    if (key in value) result[key] = value[key];
  }
  for (const key of Object.keys(value)) {
    if (!order.includes(key)) result[key] = value[key];
  }
  return result;
};

// The corrected writer serializes each Snapshot level in a fixed key order.
// Rebuilding in that order gives every repaired Snapshot the exact raw text the
// corrected writer produces, so exact reuse and publication accept the run.
const canonicalize = (
  value: unknown,
  level:
    | "top"
    | "prepare"
    | "check"
    | "specialist"
    | "acceptanceReview"
    | "acceptanceContext"
    | "profile"
    | "agentProfileConfig"
    | "runtimeConfig",
): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, level));
  if (!isJsonObject(value)) return value;
  switch (level) {
    case "top": {
      const ordered = reorderKeys(value, [
        "agentEnvironment",
        "prepare",
        "checks",
        "copyFiles",
        "specialistReviews",
        "acceptanceReview",
        "acceptanceContext",
      ]);
      ordered["prepare"] = canonicalize(ordered["prepare"], "prepare");
      ordered["checks"] = canonicalize(ordered["checks"], "check");
      ordered["specialistReviews"] = canonicalize(ordered["specialistReviews"], "specialist");
      ordered["acceptanceReview"] = canonicalize(ordered["acceptanceReview"], "acceptanceReview");
      ordered["acceptanceContext"] = canonicalize(
        ordered["acceptanceContext"],
        "acceptanceContext",
      );
      return ordered;
    }
    case "prepare":
      return reorderKeys(value, ["command", "timeoutSeconds"]);
    case "check":
      return reorderKeys(value, ["id", "command", "timeoutSeconds"]);
    case "specialist":
    case "acceptanceReview": {
      const ordered = reorderKeys(value, ["id", "instructions", "instructionsSource", "profile"]);
      ordered["profile"] = canonicalize(ordered["profile"], "profile");
      return ordered;
    }
    case "acceptanceContext":
      return reorderKeys(value, ["version", "title", "description", "comments", "resolutions"]);
    case "profile": {
      const ordered = reorderKeys(value, ["agentProfile", "scope", "profile"]);
      ordered["profile"] = canonicalize(ordered["profile"], "agentProfileConfig");
      return ordered;
    }
    case "agentProfileConfig": {
      const ordered = reorderKeys(value, ["agentRuntime", "runtimeConfig"]);
      ordered["runtimeConfig"] = canonicalize(ordered["runtimeConfig"], "runtimeConfig");
      return ordered;
    }
    case "runtimeConfig":
      return reorderKeys(value, [
        "model",
        "thinking",
        "extensions",
        "skills",
        "tools",
        "contextFileDiscovery",
      ]);
  }
};

export const repairValidationPolicySnapshotOkFieldMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const beforeCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_runs
  `;
  const runs = yield* sql<{ readonly id: string; readonly policySnapshot: string }>`
    SELECT id, policy_snapshot AS policySnapshot
    FROM candidate_validation_runs
  `;

  for (const run of runs) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(run.policySnapshot);
    } catch {
      continue;
    }
    if (!isJsonObject(parsed)) continue;
    const acceptanceReview = parsed["acceptanceReview"];
    if (!isJsonObject(acceptanceReview)) continue;
    if (acceptanceReview["ok"] !== true) continue;
    const { ok: _ignored, ...rest } = acceptanceReview;
    const withoutOk = { ...parsed, acceptanceReview: rest };
    const repairedJson = JSON.stringify(withoutOk);
    // Repair only the exact historical writer defect: removing acceptanceReview.ok
    // must already produce the corrected writer's serialized identity. Alternate
    // key orderings remain byte-for-byte unchanged and rejected by strict decode.
    if (repairedJson !== JSON.stringify(canonicalize(withoutOk, "top"))) continue;
    try {
      decodePolicySnapshot(repairedJson);
    } catch {
      continue;
    }
    yield* sql`
      UPDATE candidate_validation_runs
      SET policy_snapshot = ${repairedJson}
      WHERE id = ${run.id}
    `;
  }

  const afterCount = yield* sql<{ readonly count: number | bigint }>`
    SELECT COUNT(*) AS count FROM candidate_validation_runs
  `;
  if (Number(afterCount[0]?.count ?? -1) < Number(beforeCount[0]?.count ?? -1)) {
    return yield* Effect.fail(
      new Error("Validation Policy Snapshot repair migration lost Validation Runs"),
    );
  }
});
