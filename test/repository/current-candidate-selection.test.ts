import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../src/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../src/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../src/sqlite/sqliteChangeValidationReadPersistence.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

describe("Current Candidate selection", () => {
  it.scoped("keeps A current after the supported A to B to A capture sequence", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteCandidateValidationExecutionPort();
        const reads = yield* openSqliteChangeValidationReadPort();
        const authority = yield* openSqliteChangeAuthorityPort();
        const policy = { checks: [], copyFiles: [], specialistReviews: [] };
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-a",
          headSha: "head-a",
          now: "2026-08-12T10:00:00.000Z",
        });
        if (!first.ok) throw new Error(first.code);

        const admitted = yield* validation.startOrReuse({
          candidateId: first.candidateId,
          headSha: "head-a",
          changeBaseSha: "base-a",
          policy,
          validationRunId: "run-a",
          now: "2026-08-12T10:01:00.000Z",
        });
        expect(admitted).toMatchObject({ reused: false, validationRunId: "run-a" });
        yield* validation.complete({
          validationRunId: "run-a",
          outcome: "passed",
          now: "2026-08-12T10:02:00.000Z",
        });

        const second = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-a",
          headSha: "head-b",
          now: "2026-08-12T10:03:00.000Z",
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
          now: "2026-08-12T10:04:00.000Z",
        });
        if (!selectedAgain.ok) throw new Error(selectedAgain.code);
        expect(selectedAgain).toMatchObject({
          candidateId: first.candidateId,
          reused: true,
        });

        expect(yield* reads.getCurrentCandidateForChange(first.changeId)).toMatchObject({
          id: first.candidateId,
          headSha: "head-a",
        });
        expect(yield* authority.getCurrentPassingEvidence(first.changeId)).toEqual({
          candidateId: first.candidateId,
          validationRunId: "run-a",
          changeBaseSha: "base-a",
          headSha: "head-a",
        });

        const historicalAdmission = yield* validation
          .startOrReuse({
            candidateId: second.candidateId,
            headSha: "head-b",
            changeBaseSha: "base-a",
            policy,
            validationRunId: "run-b",
            now: "2026-08-12T10:05:00.000Z",
          })
          .pipe(Effect.flip);
        expect(historicalAdmission).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );
});
