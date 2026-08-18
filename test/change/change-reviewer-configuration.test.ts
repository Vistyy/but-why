import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  decodeSqliteChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "../../src/change/changeReviewerConfiguration.js";
import type { ChangeReviewerConfiguration } from "../../src/change/changeStartStore.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { createChange } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const specialist = (id: string) => ({
  id,
  instructions: `Review ${id}.`,
  instructionsSource: "repo" as const,
  profile: {
    agentProfile: id,
    scope: "repo" as const,
    profile: { agentRuntime: "pi" as const },
  },
});

it("strictly decodes and encodes Change reviewer configuration", () => {
  const valid = {
    acceptanceReview: null,
    specialistReviews: [specialist("standards")],
  } as const;
  expect(
    decodeSqliteChangeReviewerConfiguration(encodeSqliteChangeReviewerConfiguration(valid)),
  ).toEqual(valid);

  for (const invalid of [
    { ...valid, excess: true },
    { ...valid, specialistReviews: [specialist("standards"), specialist("standards")] },
    { ...valid, specialistReviews: [specialist("acceptance")] },
  ]) {
    expect(() => decodeSqliteChangeReviewerConfiguration(JSON.stringify(invalid))).toThrow();
    expect(() =>
      encodeSqliteChangeReviewerConfiguration(invalid as ChangeReviewerConfiguration),
    ).toThrow();
  }
});

it.scoped("rejects invalid initial reviewer configuration before inserting a Change", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const error = yield* repository
        .transactionImmediate("create invalid Change fixture", (sql) =>
          createChange(
            sql,
            {
              id: "pending",
              repositoryCommonDirectory: "/tmp/repo/.git",
              branchRef: "refs/heads/pending",
              baseRef: "refs/remotes/origin/main",
              baseRemoteUrl: "https://example.com/acme/repo.git",
              startingCommit: "head",
              worktreePath: "/tmp/pending",
              reviewerConfiguration: {
                acceptanceReview: null,
                specialistReviews: [specialist("standards"), specialist("standards")],
              },
              now: "2026-10-02T10:00:00.000Z",
            },
            repository.idPrefix,
          ),
        )
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
      const rows = yield* repository.operation(
        "count Changes after invalid reviewer configuration",
        (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM changes`,
      );
      expect(rows[0]?.count).toBe(0);
    }),
  ),
);
