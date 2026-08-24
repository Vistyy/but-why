import type * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { encodeSqliteAcceptanceContextSnapshot } from "../../src/sqlite/sqliteAcceptanceContextSnapshot.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { encodeSqliteValidationInputSnapshot } from "../../src/sqlite/sqliteValidationInputSnapshot.js";
import { openSqliteChangeValidationTestDependencies } from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const acceptanceContext = {
  version: 1 as const,
  title: "Keep the exact intent",
  description: "Review the Candidate against this immutable context.",
  comments: ["Historical comment."],
  resolutions: ["Resolve the ambiguity."],
};

const reviewerConfiguration = {
  acceptanceReview: null,
  specialistReviews: [],
  agentEnvironment: ["nix", "develop", "-c"],
} as const;

const prepare = { command: "pnpm install", timeoutSeconds: 60 } as const;
const checks = [{ id: "types", command: "pnpm typecheck", timeoutSeconds: 30 }] as const;

const insertRun = (sql: SqlClient.SqlClient, candidateId: number, validationInput: string) => sql`
  INSERT INTO validation_runs (
    candidate_id, validation_input_snapshot, outcome, cleanup_pending
  ) VALUES (${candidateId}, ${validationInput}, 'passed', 0)
`;

const createCandidateOwningChange = () =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    yield* repository.operation(
      "create Candidate-owning Change",
      (sql) => sql`
      INSERT INTO changes (
        branch_ref, base_ref, base_remote_url, worktree_path,
        initial_acceptance_context, reviewer_configuration,
        prepare_definition, checks_definition, cleanup_pending
      ) VALUES (
        'refs/heads/feature', 'refs/remotes/origin/main',
        'https://example.com/acme/repo.git', '/tmp/feature',
        ${encodeSqliteAcceptanceContextSnapshot(acceptanceContext)},
        ${JSON.stringify(reviewerConfiguration)}, ${JSON.stringify(prepare)},
        ${JSON.stringify(checks)}, 0
      )
    `,
    );
  });

const captureCandidate = (repositoryCommonDirectory: string) =>
  Effect.gen(function* () {
    const capture = yield* openSqliteCandidateCapturePersistence();
    const captured = yield* capture.commitCapture({
      repositoryCommonDirectory,
      branchRef: "refs/heads/feature",
      baseRef: "refs/remotes/origin/main",
      changeBaseSha: "base-sha",
      headSha: "head-sha",
    });
    if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
    return captured;
  });

describe("SQLite Validation Input Snapshot", () => {
  it.scoped("separates run input from the owning Change Policy", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        yield* createCandidateOwningChange();
        const captured = yield* captureCandidate(input.commonDirectory);
        const validation = yield* openSqliteChangeValidationTestDependencies();

        const started = yield* validation.execution.startOrReuse({
          candidateId: captured.candidateId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        if (started.reused || "blocked" in started || "active" in started) {
          throw new Error("Expected a new Validation Run");
        }

        expect(started.authority.changePolicy).toEqual({
          reviewerConfiguration,
          stallDetection: { enabled: false, profile: null },
          prepare,
          checks,
        });
        expect(started.authority.validationInput).toEqual({ acceptanceContext });

        const stored = yield* validation.reads.getRunById(started.validationRunId);
        expect(stored).toMatchObject({ validationInput: { acceptanceContext } });
        expect(stored).not.toHaveProperty("changePolicy");
        expect(stored).not.toHaveProperty("policy");
        expect(stored).not.toHaveProperty("reviewerConfiguration");

        const repository = yield* RepositorySql;
        const rows = yield* repository.operation(
          "read Validation Input Snapshot",
          (sql) =>
            sql<{ readonly validationInput: string }>`
            SELECT validation_input_snapshot AS validationInput
            FROM validation_runs WHERE id = ${started.validationRunId}
          `,
        );
        expect(rows[0]?.validationInput).toBe(
          encodeSqliteValidationInputSnapshot({ acceptanceContext }),
        );
      }),
    ),
  );

  it.scoped("rejects malformed persisted Validation Input", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        yield* createCandidateOwningChange();
        const captured = yield* captureCandidate(input.commonDirectory);
        const repository = yield* RepositorySql;
        yield* repository.operation("insert malformed Validation Input", (sql) =>
          insertRun(sql, captured.candidateId, JSON.stringify({ checks: [] })),
        );
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const error = yield* validation.reads.getRunById(1).pipe(Effect.flip);
        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );
});
