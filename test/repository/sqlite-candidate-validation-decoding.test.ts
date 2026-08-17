import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangeValidationTestDependencies } from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const policy = {
  checks: [],
  copyFiles: [],
  acceptanceReview: {
    instructions: "Review acceptance.",
    instructionsSource: "repo",
    profile: {
      agentProfile: "acceptance",
      scope: "repo",
      profile: { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
    },
  },
  specialistReviews: [],
} as const;
const now = "2026-08-10T00:00:00.000Z";

const createCandidateOwningChange = (branchRef: string) =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    yield* repository.operation(
      "create Candidate-owning Change",
      (sql) => sql`
      INSERT INTO changes (
        branch_ref, base_ref, base_remote_url, worktree_path,
        reviewer_configuration, cleanup_pending
      ) VALUES (
        ${branchRef}, 'refs/remotes/origin/main',
        'https://example.com/acme/repo.git', ${`/tmp/${branchRef.slice("refs/heads/".length)}`},
        '{"acceptanceReview":null,"specialistReviews":[]}', 0
      )
    `,
    );
  });

const createRun = (commonDirectory: string, branchRef: string) =>
  Effect.gen(function* () {
    yield* createCandidateOwningChange(branchRef);
    const capture = yield* openSqliteCandidateCapturePersistence();
    const validation = yield* openSqliteChangeValidationTestDependencies();
    const captured = yield* capture.commitCapture({
      repositoryCommonDirectory: commonDirectory,
      branchRef,
      baseRef: "refs/remotes/origin/main",
      changeBaseSha: "base",
      headSha: "head",
      now,
    });
    if (!captured.ok) throw new Error(captured.code);
    const started = yield* validation.execution.startOrReuse({
      candidateId: captured.candidateId,
      changeBaseSha: "base",
      headSha: "head",
      policy,
      now,
    });
    if (started.reused || "blocked" in started || "active" in started) {
      throw new Error("Expected a new Validation Run");
    }
    return { captured, started, validation };
  });

describe("SQLite Candidate and Validation read decoding", () => {
  it.scoped("decodes compact Candidate, Validation Run, and phase evidence records", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { captured, started, validation } = yield* createRun(
          input.commonDirectory,
          "refs/heads/decoding",
        );
        yield* validation.execution.recordAcceptanceResult({
          validationRunId: started.validationRunId,
          outcome: "failed",
          findings: [
            {
              validationRunId: started.validationRunId,
              phase: "acceptance_review",
              producer: "acceptance",
              title: "Fix the issue",
              description: "The Candidate has an issue.",
              evidence: "Observed in the Candidate.",
              files: ["src/main.ts"],
              artifactRefs: ["artifact:1/acceptance_review/acceptance/stdout.txt"],
            },
          ],
          artifactRecords: [
            {
              ref: "artifact:1/acceptance_review/acceptance/stdout.txt",
              validationRunId: started.validationRunId,
              phase: "acceptance_review",
              producer: "acceptance",
              path: "1/acceptance_review/acceptance/stdout.txt",
              originalBytes: 10,
              storedBytes: 7,
              truncated: true,
            },
          ],
          now,
        });
        yield* validation.execution.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* validation.execution.complete({
          validationRunId: started.validationRunId,
          outcome: "blocked",
          now,
        });

        expect(yield* validation.reads.getCandidateById(captured.candidateId)).toMatchObject({
          id: captured.candidateId,
          changeId: captured.changeId,
          changeBaseSha: "base",
          headSha: "head",
        });
        expect(yield* validation.reads.getRunById(started.validationRunId)).toMatchObject({
          id: started.validationRunId,
          candidateId: captured.candidateId,
          state: "complete",
          outcome: "blocked",
        });
        expect(yield* validation.reads.listFindings(started.validationRunId)).toMatchObject([
          { title: "Fix the issue", files: ["src/main.ts"] },
        ]);
        expect(yield* validation.reads.listArtifacts(started.validationRunId)).toMatchObject([
          { originalBytes: 10, storedBytes: 7, truncated: true },
        ]);
      }),
    ),
  );

  it.scoped("rejects malformed compact phase evidence at the SQLite boundary", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { started, validation } = yield* createRun(
          input.commonDirectory,
          "refs/heads/malformed-decoding",
        );
        yield* validation.execution.recordCheckResult({
          validationRunId: started.validationRunId,
          producer: "types",
          outcome: "failed",
          finding: {
            validationRunId: started.validationRunId,
            phase: "checks",
            producer: "types",
            title: "Types failed",
            description: "Type checking failed.",
            evidence: "Exit code 1.",
            files: [],
            artifactRefs: [],
          },
          artifactRecords: [],
          now,
        });
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "corrupt compact Finding evidence",
          (sql) => sql`
          UPDATE validation_phase_results
          SET findings = '[{"title":]'
          WHERE validation_run_id = ${started.validationRunId}
            AND phase = 'checks' AND producer = 'types'
        `,
        );

        expect(
          yield* validation.reads.listFindings(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );
});
