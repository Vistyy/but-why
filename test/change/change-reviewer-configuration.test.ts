import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ChangePolicy, ChangeReviewerConfiguration } from "../../src/change/changePolicy.js";
import {
  decodeSqliteChangeReviewerConfiguration,
  encodeSqliteChangeReviewerConfiguration,
} from "../../src/change/changeReviewerConfiguration.js";
import { resolveChangePolicyAtCommit } from "../../src/change/composition/resolveChangePolicy.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import {
  createChange,
  readChangeStartById,
} from "../../src/sqlite/sqliteChangeStartPersistence.js";
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
    { ...valid, agentEnvironment: [] },
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

    writeFileSync(
      configPath,
      JSON.stringify({
        idPrefix: "BY",
        validation: {
          checks: [
            { id: "quality", command: "first" },
            { id: "quality", command: "second" },
          ],
        },
      }),
    );
    runTestProcessOrThrow("git", ["add", ".but-why/config.json"], { cwd: root });
    runTestProcessOrThrow("git", ["commit", "-m", "duplicate checks"], { cwd: root });
    const duplicateChecksBase = runTestProcessOrThrow("git", ["rev-parse", "HEAD"], {
      cwd: root,
    });
    expect(
      yield* resolveChangePolicyAtCommit({
        repositoryRoot: root,
        commit: duplicateChecksBase,
        globalConfigPath,
        acceptanceContextSupplied: false,
        expectedIdPrefix: "BY",
      }),
    ).toEqual({
      ok: false,
      code: "reviewer_configuration_invalid",
      message: "Duplicate check id: quality",
    });

    runTestProcessOrThrow("git", ["rm", "-f", ".but-why/config.json"], { cwd: root });
    runTestProcessOrThrow("git", ["commit", "-m", "missing config"], { cwd: root });
    const missingBase = runTestProcessOrThrow("git", ["rev-parse", "HEAD"], { cwd: root });
    expect(
      yield* resolveChangePolicyAtCommit({
        repositoryRoot: root,
        commit: missingBase,
        globalConfigPath,
        acceptanceContextSupplied: false,
        expectedIdPrefix: "BY",
      }),
    ).toMatchObject({ ok: false, code: "committed_repo_config_missing" });

    writeFileSync(configPath, "malformed");
    runTestProcessOrThrow("git", ["add", ".but-why/config.json"], { cwd: root });
    runTestProcessOrThrow("git", ["commit", "-m", "invalid config"], { cwd: root });
    const invalidBase = runTestProcessOrThrow("git", ["rev-parse", "HEAD"], { cwd: root });
    expect(
      yield* resolveChangePolicyAtCommit({
        repositoryRoot: root,
        commit: invalidBase,
        globalConfigPath,
        acceptanceContextSupplied: false,
        expectedIdPrefix: "BY",
      }),
    ).toMatchObject({ ok: false, code: "committed_repo_config_invalid" });
  });
});

it.scoped("rejects invalid Change Policy before inserting a Change", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const validReviewerConfiguration = {
        acceptanceReview: null,
        specialistReviews: [],
      } as const;
      const invalidPolicies = [
        {
          reviewerConfiguration: {
            acceptanceReview: null,
            specialistReviews: [specialist("standards"), specialist("standards")],
          },
          prepare: null,
          checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
        },
        {
          reviewerConfiguration: validReviewerConfiguration,
          prepare: null,
          checks: [],
        },
        {
          reviewerConfiguration: validReviewerConfiguration,
          prepare: { command: " ", timeoutSeconds: 30 },
          checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
        },
      ];

      for (const invalidPolicy of invalidPolicies) {
        const error = yield* repository
          .transactionImmediate("create invalid Change fixture", (sql) =>
            createChange(
              sql,
              {
                baseRef: "refs/remotes/origin/main",
                baseRemoteUrl: "https://example.com/acme/repo.git",
                managedWorktreeParent: "/tmp",
                policy: invalidPolicy as unknown as ChangePolicy,
              },
              repository.idPrefix,
            ),
          )
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }

      const rows = yield* repository.operation(
        "count Changes after invalid Change Policies",
        (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM changes`,
      );
      expect(rows[0]?.count).toBe(0);
    }),
  ),
);

it.scoped("rejects invalid persisted Change Policy on read", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const readInvalid = (prepareDefinition: string | null, checksDefinition: string) =>
        repository.transactionImmediate("read invalid Change Policy fixture", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              DELETE FROM changes
            `;
            yield* sql`
              INSERT INTO changes (
                id, branch_ref, base_ref, base_remote_url, worktree_path,
                reviewer_configuration, prepare_definition, checks_definition, cleanup_pending
              ) VALUES (
                1, 'refs/heads/invalid-policy', 'refs/remotes/origin/main',
                'https://example.com/acme/repo.git', '/tmp/invalid-policy',
                '{"acceptanceReview":null,"specialistReviews":[]}',
                ${prepareDefinition}, ${checksDefinition}, 0
              )
            `;
            return yield* readChangeStartById(sql, "BY-C1", repository.idPrefix);
          }),
        );

      const emptyChecks = yield* readInvalid(null, "[]").pipe(Effect.flip);
      expect(emptyChecks).toBeInstanceOf(RepositoryPersistedDataInvalid);

      const blankPrepare = yield* readInvalid(
        JSON.stringify({ command: " ", timeoutSeconds: 30 }),
        JSON.stringify([{ id: "quality", command: "true", timeoutSeconds: 30 }]),
      ).pipe(Effect.flip);
      expect(blankPrepare).toBeInstanceOf(RepositoryPersistedDataInvalid);
    }),
  ),
);
