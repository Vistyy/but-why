import type * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { CandidateValidationPolicySnapshot } from "../../src/change/candidateValidation/candidateValidationPolicySnapshot.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { encodeSqliteAcceptanceContextSnapshot } from "../../src/sqlite/sqliteAcceptanceContextSnapshot.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { encodeSqliteCandidateValidationPolicy } from "../../src/sqlite/sqliteCandidateValidationPolicy.js";
import { openSqliteChangeValidationTestDependencies } from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

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

const malformedPolicyRuns: readonly { readonly id: number; readonly policyJson: string }[] = [
  { id: 101, policyJson: '{"checks":' },
  {
    id: 102,
    policyJson: JSON.stringify({
      acceptanceContext: currentPolicy.acceptanceContext,
      agentEnvironment: currentPolicy.agentEnvironment,
      prepare: currentPolicy.prepare,
      copyFiles: currentPolicy.copyFiles,
      acceptanceReview: currentPolicy.acceptanceReview,
      specialistReviews: currentPolicy.specialistReviews,
    }),
  },
  { id: 103, policyJson: JSON.stringify({ ...currentPolicy, checks: {} }) },
  {
    id: 104,
    policyJson: JSON.stringify({
      ...currentPolicy,
      checks: [{ ...currentPolicy.checks[0], timeoutSeconds: "30" }],
    }),
  },
  {
    id: 105,
    policyJson: JSON.stringify({
      ...currentPolicy,
      specialistReviews: [{ ...currentPolicy.specialistReviews[0], instructionsSource: "bogus" }],
    }),
  },
  {
    id: 106,
    policyJson: JSON.stringify({
      ...currentPolicy,
      specialistReviews: [
        {
          ...currentPolicy.specialistReviews[0],
          agentProfile: "security",
          profileScope: "repo",
        },
      ],
    }),
  },
];

const insertPolicyRun = (
  sql: SqlClient.SqlClient,
  candidateId: number,
  id: number,
  policyJson: string,
) => sql`
  INSERT INTO validation_runs (
    id, candidate_id, policy_snapshot, outcome, cleanup_pending
  ) VALUES (${id}, ${candidateId}, ${policyJson}, 'passed', 0)
`;

const createCandidateOwningChange = (branchRef: string) =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    yield* repository.operation(
      "create Candidate-owning Change",
      (sql) => sql`
      INSERT INTO changes (
        branch_ref, base_ref, base_remote_url, worktree_path,
        initial_acceptance_context, reviewer_configuration, cleanup_pending
      ) VALUES (
        ${branchRef}, 'refs/remotes/origin/main',
        'https://example.com/acme/repo.git', ${`/tmp/${branchRef.slice("refs/heads/".length)}`},
        ${encodeSqliteAcceptanceContextSnapshot(currentPolicy.acceptanceContext)},
        '{"acceptanceReview":null,"specialistReviews":[]}', 0
      )
    `,
    );
  });

describe("SQLite Candidate Validation Policy Snapshot decode", () => {
  it.scoped("decodes a current Validation Policy Snapshot written by But Why", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        yield* createCandidateOwningChange("refs/heads/feature");
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);

        const started = yield* validation.execution.startOrReuse({
          candidateId: captured.candidateId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          policy: currentPolicy,
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
            FROM validation_runs
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
        yield* createCandidateOwningChange("refs/heads/feature");
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const repository = yield* RepositorySql;
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
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
            SELECT COUNT(*) AS count FROM validation_runs
          `,
        );
        const activeRuns = yield* repository.operation(
          "count Active Validation Runs after rejected excess-field policy",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM validation_runs WHERE outcome IS NULL
          `,
        );
        expect(runs[0]?.count ?? -1).toBe(0);
        expect(activeRuns[0]?.count ?? -1).toBe(0);
      }),
    ),
  );

  it.scoped("rejects semantically invalid Validation Policy Snapshots before insertion", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        yield* createCandidateOwningChange("refs/heads/semantic-policy");
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/semantic-policy",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);

        const invalidPolicies = [
          {
            ...currentPolicy,
            checks: [currentPolicy.checks[0], currentPolicy.checks[0]],
          },
          {
            ...currentPolicy,
            checks: [{ ...currentPolicy.checks[0], timeoutSeconds: 0 }],
          },
          {
            ...currentPolicy,
            prepare: { ...currentPolicy.prepare, timeoutSeconds: Number.MAX_SAFE_INTEGER + 1 },
          },
          {
            ...currentPolicy,
            specialistReviews: [
              currentPolicy.specialistReviews[0],
              currentPolicy.specialistReviews[0],
            ],
          },
          {
            ...currentPolicy,
            specialistReviews: [{ ...currentPolicy.specialistReviews[0], id: "acceptance" }],
          },
        ];
        for (const policy of invalidPolicies) {
          const error = yield* validation.execution
            .startOrReuse({
              candidateId: captured.candidateId,
              changeBaseSha: "base-sha",
              headSha: "head-sha",
              policy: policy as CandidateValidationPolicySnapshot,
            })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        }

        const repository = yield* RepositorySql;
        const rows = yield* repository.operation(
          "count rejected semantic Validation Policies",
          (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM validation_runs`,
        );
        expect(rows[0]?.count).toBe(0);
      }),
    ),
  );

  it.scoped("rejects malformed persisted Validation Policy Snapshots at the SQLite boundary", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        yield* createCandidateOwningChange("refs/heads/feature");
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const repository = yield* RepositorySql;
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
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
