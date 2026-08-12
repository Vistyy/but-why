import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

type JsonObject = Record<string, unknown> & {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly agentProfile?: unknown;
  readonly profileScope?: unknown;
  readonly instructions?: unknown;
  readonly profile?: unknown;
  readonly scope?: unknown;
  readonly builtInInstructions?: unknown;
  readonly guidance?: unknown;
  readonly content?: unknown;
  readonly source?: unknown;
};

const object = (value: unknown, label: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as JsonObject;
};

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  return value;
};

const canonicalPolicy = (source: string): string => {
  const policy = object(JSON.parse(source), "Task Review policy snapshot");
  if (policy.id === "task_advisory_review" && policy.version === 1) {
    if (policy.profileScope !== "global") throw new Error("Invalid legacy profile scope");
    return JSON.stringify({
      profile: {
        agentProfile: text(policy.agentProfile, "legacy Agent Profile"),
        scope: "global",
        profile: { agentRuntime: "pi" },
      },
      builtInInstructions: text(policy.instructions, "legacy built-in instructions"),
      guidance: null,
    });
  }

  const legacy = policy.id === "task_advisory_review" && policy.version === 2;
  const current = policy.id === "task_review" && policy.version === 3;
  if (!legacy && !current) throw new Error("Invalid Task Review policy identity");
  const profile = object(policy.profile, "Task Review policy profile");
  const scope = profile.scope;
  if (scope !== "repo" && scope !== "global") throw new Error("Invalid Agent Profile scope");
  const guidance =
    policy.guidance === null
      ? null
      : (() => {
          const value = object(policy.guidance, "Task Review guidance");
          const source = value.source;
          if (source !== "repo" && source !== "global") {
            throw new Error("Invalid Task Review guidance source");
          }
          return { content: text(value.content, "Task Review guidance content"), source };
        })();
  return JSON.stringify({
    profile: {
      agentProfile: text(profile.agentProfile, "Agent Profile name"),
      scope,
      profile: object(profile.profile, "Agent Profile configuration"),
    },
    builtInInstructions: text(policy.builtInInstructions, "built-in instructions"),
    guidance,
  });
};

export const unversionTaskReviewPolicySnapshotsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const reviews = yield* sql<{ readonly id: string; readonly policySnapshot: string }>`
    SELECT id, policy_snapshot AS policySnapshot FROM task_reviews
  `;
  for (const review of reviews) {
    const policySnapshot = yield* Effect.try({
      try: () => canonicalPolicy(review.policySnapshot),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Invalid Task Review policy snapshot", { cause }),
    });
    yield* sql`
      UPDATE task_reviews
      SET policy_snapshot = ${policySnapshot}
      WHERE id = ${review.id}
    `;
  }
});
