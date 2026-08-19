import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ChangeReviewerConfiguration } from "../../src/change/changePolicy.js";
import {
  decodeSqliteChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "../../src/change/changeReviewerConfiguration.js";
import { resolveChangePolicyAtCommit } from "../../src/change/composition/resolveChangePolicy.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { createChange } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { createGitRepo } from "../support/by-cli.js";
import { withTemporaryRepositoryState } from "../support/repository.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";

const specialist = (id: string) => ({
  id,
  instructions: `Review ${id}.`,
  instructionsSource: "repo" as const,
  profile: {
    agentProfile: id,
    scope: "repo" as const,
    profile: { agentRuntime: "pi" as const, runtimeConfig: { model: `${id}-model` } },
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
    {
      ...valid,
      specialistReviews: [
        {
          ...specialist("standards"),
          profile: {
            ...specialist("standards").profile,
            profile: { agentRuntime: "pi" as const, runtimeConfig: { model: " " } },
          },
        },
      ],
    },
  ]) {
    expect(() => decodeSqliteChangeReviewerConfiguration(JSON.stringify(invalid))).toThrow();
    expect(() =>
      encodeSqliteChangeReviewerConfiguration(invalid as ChangeReviewerConfiguration),
    ).toThrow();
  }
});

it.effect("resolves and validates reviewer authority from the exact Change Base commit", () => {
  const root = createGitRepo();
  runTestProcessOrThrow("git", ["config", "user.name", "But Why Test"], { cwd: root });
  runTestProcessOrThrow("git", ["config", "user.email", "test@but-why.invalid"], { cwd: root });
  const configPath = join(root, ".but-why", "config.json");
  const instructionsPath = join(root, ".but-why", "reviewers", "base.md");
  mkdirSync(join(root, ".but-why", "reviewers"), { recursive: true });
  writeFileSync(instructionsPath, "Review exact base authority.\n");
  writeFileSync(
    configPath,
    JSON.stringify({
      idPrefix: "BY",
      agentProfiles: {
        base: {
          agentRuntime: "pi",
          runtimeConfig: { model: "base-model" },
        },
      },
      review: { specialists: ["base"] },
      reviewers: {
        base: {
          agentProfile: { scope: "repo", name: "base" },
          instructionsFile: ".but-why/reviewers/base.md",
        },
      },
      prepare: { command: "prepare exact base", timeoutSeconds: 17 },
      validation: {
        checks: [{ id: "exact-base", command: "check exact base", timeoutSeconds: 23 }],
      },
    }),
  );
  runTestProcessOrThrow("git", ["add", "."], { cwd: root });
  runTestProcessOrThrow("git", ["commit", "-m", "exact base"], { cwd: root });
  const exactBase = runTestProcessOrThrow("git", ["rev-parse", "HEAD"], { cwd: root });

  writeFileSync(
    configPath,
    JSON.stringify({
      idPrefix: "BY",
      review: { specialists: [] },
    }),
  );
  const globalConfigPath = join(root, "global-config.json");
  writeFileSync(globalConfigPath, "{}");

  return Effect.gen(function* () {
    const resolved = yield* resolveChangePolicyAtCommit({
      repositoryRoot: root,
      commit: exactBase,
      globalConfigPath,
      acceptanceContextSupplied: false,
      expectedIdPrefix: "BY",
    });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved).toMatchObject({
      ok: true,
      policy: {
        reviewerConfiguration: {
          specialistReviews: [
            {
              id: "base",
              instructions: "Review exact base authority.\n",
              profile: {
                agentProfile: "base",
                profile: { runtimeConfig: { model: "base-model" } },
              },
            },
          ],
        },
        prepare: { command: "prepare exact base", timeoutSeconds: 17 },
        checks: [{ id: "exact-base", command: "check exact base", timeoutSeconds: 23 }],
      },
    });
  });
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
              policy: {
                reviewerConfiguration: {
                  acceptanceReview: null,
                  specialistReviews: [specialist("standards"), specialist("standards")],
                },
                prepare: null,
                checks: [],
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
