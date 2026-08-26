import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { openSqliteCandidateCapturePersistence } from "../../src/change/adapters/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../src/change/adapters/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../src/change/adapters/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../src/change/adapters/sqlite/sqliteChangeValidationReadPersistence.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

describe("Current Candidate selection", () => {
  it.scoped("records a new current occurrence after an A to B to A capture sequence", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "create Candidate-owning Change",
          (sql) => sql`
          INSERT INTO changes (
            branch_ref, base_ref, base_remote_url, worktree_path,
            reviewer_configuration, checks_definition, cleanup_pending
          ) VALUES (
            'refs/heads/feature', 'refs/remotes/origin/main',
            'https://example.com/acme/repo.git', '/tmp/feature',
            '{"acceptanceReview":null,"specialistReviews":[]}', '[{"id":"quality","command":"true","timeoutSeconds":30}]', 0
          )
        `,
        );
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteCandidateValidationExecutionPort();
        const reads = yield* openSqliteChangeValidationReadPort();
        const authority = yield* openSqliteChangeAuthorityPort();
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-a",
          headSha: "head-a",
        });
        if (!first.ok) throw new Error(first.code);

        const admitted = yield* validation.startOrReuse({
          candidateId: first.candidateId,
          headSha: "head-a",
          changeBaseSha: "base-a",
        });
        expect(admitted).toMatchObject({ reused: false, validationRunId: 1 });
        if (admitted.reused || "blocked" in admitted || "active" in admitted) {
          throw new Error("Expected a new Validation Run");
        }
        yield* validation.recordCheckResult({
          validationRunId: admitted.validationRunId,
          producer: "quality",
          outcome: "passed",
          artifactRecords: [],
        });
        yield* validation.recordWorkspaceCleanup({
          validationRunId: admitted.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* validation.complete({
          validationRunId: admitted.validationRunId,
          outcome: "passed",
        });

        const second = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-a",
          headSha: "head-b",
        });
        if (!second.ok) throw new Error(second.code);
        expect(second.reused).toBe(false);

        const selectedAgain = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-a",
          headSha: "head-a",
        });
        if (!selectedAgain.ok) throw new Error(selectedAgain.code);
        expect(selectedAgain).toMatchObject({
          candidateId: 3,
          reused: false,
        });

        expect(yield* reads.getCurrentCandidateForChange(first.changeId)).toMatchObject({
          id: 3,
          headSha: "head-a",
        });
        expect(yield* authority.getCurrentPassingEvidence(first.changeId)).toBeUndefined();

        const historicalAdmission = yield* validation
          .startOrReuse({
            candidateId: second.candidateId,
            headSha: "head-b",
            changeBaseSha: "base-a",
          })
          .pipe(Effect.flip);
        expect(historicalAdmission).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );
});
