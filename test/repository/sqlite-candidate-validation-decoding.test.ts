import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
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
    const rows = yield* repository.operation(
      "create Candidate-owning Change",
      (sql) => sql<{ readonly id: number }>`
        INSERT INTO changes (
          branch_ref, base_ref, base_remote_url, worktree_path,
          reviewer_configuration, cleanup_pending
        ) VALUES (
          ${branchRef}, 'refs/remotes/origin/main',
          'https://example.com/acme/repo.git', ${`/tmp/${branchRef.slice("refs/heads/".length)}`},
          '{"acceptanceReview":null,"specialistReviews":[]}', 0
        )
        RETURNING id
      `,
    );
    const changeId = rows[0]?.id;
    if (changeId === undefined) throw new Error("Change identity was not allocated");
    return changeId;
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

  it.scoped("rejects a Validation Run Blocker boundary from another Change", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { captured, started, validation } = yield* createRun(
          input.commonDirectory,
          "refs/heads/blocker-boundary",
        );
        yield* validation.execution.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* validation.execution.complete({
          validationRunId: started.validationRunId,
          outcome: "passed",
          now,
        });

        const otherChangeId = yield* createCandidateOwningChange(
          "refs/heads/other-blocker-boundary",
        );
        const repository = yield* RepositorySql;
        const blockerRows = yield* repository.operation(
          "create foreign Validation Run Blocker boundary",
          (sql) => sql<{ readonly id: number }>`
            INSERT INTO implementation_blockers (change_id, content, resolution_content)
            VALUES (${otherChangeId}, 'Foreign blocker', NULL)
            RETURNING id
          `,
        );
        const foreignBlockerId = blockerRows[0]?.id;
        if (foreignBlockerId === undefined) throw new Error("Blocker identity was not allocated");
        yield* repository.operation(
          "bind foreign Validation Run Blocker boundary",
          (sql) => sql`
            UPDATE validation_runs
            SET highest_blocker_id = ${foreignBlockerId}
            WHERE id = ${started.validationRunId}
          `,
        );

        expect(
          yield* validation.reads.getRunById(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* validation.execution
            .startOrReuse({
              candidateId: captured.candidateId,
              changeBaseSha: "base",
              headSha: "head",
              policy,
              now,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const changes = yield* openSqliteChangeTestDependencies();
        expect(
          yield* changes.publication.getCurrentPassingEvidence(captured.changeId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* changes.publication
            .beginPublication({
              changeId: captured.changeId,
              candidateId: captured.candidateId,
              validationRunId: started.validationRunId,
              target: {
                owner: "acme",
                repo: "widgets",
                baseBranch: "main",
                remoteName: "origin",
              },
              headBranch: "blocker-boundary",
              expectedHeadSha: "head",
              now,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
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
