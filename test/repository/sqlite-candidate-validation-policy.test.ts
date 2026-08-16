import type * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { CandidateValidationPolicySnapshot } from "../../src/change/candidateValidation/candidateValidationPolicySnapshot.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { encodeSqliteCandidateValidationPolicy } from "../../src/sqlite/sqliteCandidateValidationPolicy.js";
import { openSqliteChangeValidationTestDependencies } from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const now = "2026-07-25T16:00:00.000Z";

const currentPolicy = {
  acceptanceContext: {
    version: 1 as const,
    title: "Keep the exact intent",
    description: "Review the Candidate against this immutable context.",
    comments: ["Historical comment."],
    resolutions: ["Resolve the ambiguity."],
  },
  agentEnvironment: ["nix", "develop", "-c"] as const,
  prepare: { command: "pnpm install", timeoutSeconds: 60 },
  checks: [{ id: "types", command: "pnpm typecheck", timeoutSeconds: 30 }],
  copyFiles: [".env.test"],
  acceptanceReview: {
    instructions: "Review against the accepted intent.",
    instructionsSource: "built_in" as const,
    profile: {
      agentProfile: "acceptance",
      scope: "global" as const,
      globalConfigDirectory: "/home/test/.config/but-why",
      profile: {
        agentRuntime: "pi" as const,
        runtimeConfig: {
          model: "acceptance-model",
          thinking: "high" as const,
          extensions: ["extensions/one"],
          skills: ["skills/acceptance"],
          tools: ["acceptance-tool"],
          contextFileDiscovery: true,
        },
      },
    },
  },
  specialistReviews: [
    {
      id: "security",
      instructions: "Review security.",
      instructionsSource: "repo" as const,
      profile: {
        agentProfile: "security",
        scope: "repo" as const,
        profile: {
          agentRuntime: "pi" as const,
          runtimeConfig: { model: "security-model" },
        },
      },
    },
  ],
};

const malformedPolicyRuns: readonly { readonly id: string; readonly policyJson: string }[] = [
  { id: "run-bad-syntax", policyJson: '{"checks":' },
  { id: "run-missing-checks", policyJson: '{"copyFiles":[]}' },
  { id: "run-bad-container", policyJson: '{"checks":{},"copyFiles":[]}' },
  {
    id: "run-bad-nested-type",
    policyJson: '{"checks":[{"id":"types","command":"true","timeoutSeconds":"30"}],"copyFiles":[]}',
  },
  {
    id: "run-bad-choice",
    policyJson:
      '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"s","instructions":"i","instructionsSource":"bogus","profile":{"agentProfile":"a","scope":"repo","profile":{"agentRuntime":"pi"}}}]}',
  },
  {
    id: "run-pre-current-fields",
    policyJson:
      '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"s","instructions":"i","instructionsSource":"repo","agentProfile":"a","profileScope":"repo","profile":{"agentProfile":"a","scope":"repo","profile":{"agentRuntime":"pi"}}}]}',
  },
];

const insertPolicyRun = (
  sql: SqlClient.SqlClient,
  candidateId: string,
  id: string,
  policyJson: string,
) => sql`
  INSERT INTO candidate_validation_runs (
    id, candidate_id, policy_snapshot, implementation_decisions,
    latest_resolved_blocker_id, state, outcome, created_at, updated_at
  ) VALUES (
    ${id}, ${candidateId}, ${policyJson}, '[]', NULL, 'complete', 'passed',
    '2026-07-25T16:00:00.000Z', '2026-07-25T16:00:00.000Z'
  )
`;

describe("SQLite Candidate Validation Policy Snapshot decode", () => {
  it.scoped("decodes a current Validation Policy Snapshot written by But Why", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now,
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);

        const started = yield* validation.execution.startOrReuse({
          candidateId: captured.candidateId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          policy: currentPolicy,
          now,
        });
        if (started.reused || "blocked" in started)
          throw new Error("Expected a new Validation Run");

        const stored = yield* validation.reads.getRunById(started.validationRunId);
        expect(stored).toBeDefined();
        expect(stored?.policy).toEqual(currentPolicy);

        const repository = yield* RepositorySql;
        const rawRows = yield* repository.operation(
          "read stored Validation Policy Snapshot text",
          (sql) => sql<{ readonly policySnapshot: string }>`
            SELECT policy_snapshot AS policySnapshot
            FROM candidate_validation_runs
            WHERE id = ${started.validationRunId}
          `,
        );
        expect(rawRows[0]?.policySnapshot).toBe(
          encodeSqliteCandidateValidationPolicy(currentPolicy),
        );
      }),
    ),
  );

  it.scoped("rejects an excess policy field before inserting any Validation Run", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const repository = yield* RepositorySql;
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now,
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);

        const error = yield* validation.execution
          .startOrReuse({
            candidateId: captured.candidateId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            policy: {
              ...currentPolicy,
              acceptanceReview: {
                ...currentPolicy.acceptanceReview,
                ok: true,
              },
            } as CandidateValidationPolicySnapshot,
            now,
          })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({
          _tag: "RepositoryPersistedDataInvalid",
          operationName: "start Candidate Validation Run",
        });

        const runs = yield* repository.operation(
          "count Validation Runs after rejected excess-field policy",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM candidate_validation_runs
          `,
        );
        const activeRuns = yield* repository.operation(
          "count Active Validation Runs after rejected excess-field policy",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM active_validation_runs
          `,
        );
        expect(runs[0]?.count ?? -1).toBe(0);
        expect(activeRuns[0]?.count ?? -1).toBe(0);
      }),
    ),
  );

  it.scoped("rejects malformed persisted Validation Policy Snapshots at the SQLite boundary", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const repository = yield* RepositorySql;
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now,
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);

        for (const malformed of malformedPolicyRuns) {
          yield* repository.operation(
            `insert malformed Validation Run policy ${malformed.id}`,
            (sql) => insertPolicyRun(sql, captured.candidateId, malformed.id, malformed.policyJson),
          );
          const error = yield* validation.reads.getRunById(malformed.id).pipe(Effect.flip);
          expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
          expect(error).toMatchObject({
            _tag: "RepositoryPersistedDataInvalid",
            operationName: "decode Candidate Validation Run",
          });
        }
      }),
    ),
  );
});
