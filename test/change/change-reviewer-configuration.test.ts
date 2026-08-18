import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  decodeSqliteChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "../../src/change/changeReviewerConfiguration.js";
import type { ChangeReviewerConfiguration } from "../../src/change/changeStartStore.js";
import { resolveChangeReviewerConfigurationAtCommit } from "../../src/change/composition/resolveChangeReviewerConfiguration.js";
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
  const extensionPath = join(root, "extensions", "base.ts");
  mkdirSync(join(root, ".but-why", "reviewers"), { recursive: true });
  mkdirSync(join(root, "extensions"), { recursive: true });
  writeFileSync(instructionsPath, "Review exact base authority.\n");
  writeFileSync(extensionPath, "export {};\n");
  writeFileSync(
    configPath,
    JSON.stringify({
      idPrefix: "BY",
      agentProfiles: {
        base: {
          agentRuntime: "pi",
          runtimeConfig: { model: "base-model", extensions: ["extensions/base.ts"] },
        },
      },
      review: { specialists: ["base"] },
      reviewers: {
        base: {
          agentProfile: { scope: "repo", name: "base" },
          instructionsFile: ".but-why/reviewers/base.md",
        },
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
    const resolved = yield* resolveChangeReviewerConfigurationAtCommit({
      repoRoot: root,
      workspaceContainerRoot: join(root, ".git", "but-why", "exact-change-base-workspaces"),
      commit: exactBase,
      globalConfigPath,
      acceptanceContextSupplied: false,
      expectedIdPrefix: "BY",
    });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved).toMatchObject({
      ok: true,
      configuration: {
        specialistReviews: [
          {
            id: "base",
            instructions: "Review exact base authority.\n",
            profile: {
              agentProfile: "base",
              profile: { runtimeConfig: { extensions: ["extensions/base.ts"] } },
            },
          },
        ],
      },
    });

    rmSync(extensionPath);
    runTestProcessOrThrow("git", ["add", "extensions/base.ts"], { cwd: root });
    runTestProcessOrThrow("git", ["commit", "-m", "missing resource"], { cwd: root });
    const missingResourceBase = runTestProcessOrThrow("git", ["rev-parse", "HEAD"], {
      cwd: root,
    });
    const invalid = yield* resolveChangeReviewerConfigurationAtCommit({
      repoRoot: root,
      workspaceContainerRoot: join(root, ".git", "but-why", "exact-change-base-workspaces"),
      commit: missingResourceBase,
      globalConfigPath,
      acceptanceContextSupplied: false,
      expectedIdPrefix: "BY",
    });
    expect(invalid).toMatchObject({
      ok: false,
      message: expect.stringContaining("missing extension resource"),
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
