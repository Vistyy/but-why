import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { ChangePersistence } from "../../src/change/changePersistence.js";
import { openTerminalCleanup } from "../../src/change/cleanupTerminalChange.js";
import type { GitHubPullRequestGateway } from "../../src/change/ownedPullRequestGateway.js";
import { openChangeReconciliation } from "../../src/change/reconcileChange.js";
import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { openArtifactLifecycle } from "../../src/change/validationRun/artifactLifecycle.js";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const now = "2026-08-05T10:00:00.000Z";

const policy = {
  prepare: { command: "true", timeoutSeconds: 10 },
  checks: [{ id: "check", command: "true", timeoutSeconds: 10 }],
  copyFiles: [],
};

type RawRunRow = {
  readonly id: string;
  readonly candidateId: string;
  readonly policySnapshot: string;
  readonly implementationDecisions: string;
  readonly latestResolvedBlockerId: string | null;
  readonly state: string;
  readonly outcome: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type RawArtifactRow = {
  readonly ref: string;
  readonly validationRunId: string;
  readonly phase: string;
  readonly producer: string;
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: number;
  readonly createdAt: string;
};

const unusedGitHubGateway: GitHubPullRequestGateway = {
  findPullRequests: () => {
    throw new Error("Closed Change reconciliation must not observe pull requests");
  },
  getPullRequest: () => {
    throw new Error("Closed Change reconciliation must not observe pull requests");
  },
  createPullRequest: () => {
    throw new Error("Reconciliation must not create a pull request");
  },
  updatePullRequest: () => {
    throw new Error("Reconciliation must not update a pull request");
  },
};

let candidateValidationRepoTemplate: string;

beforeAll(() => {
  candidateValidationRepoTemplate = acquireTestWorkspace();
  createInitializedRepo(candidateValidationRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(candidateValidationRepoTemplate);
});

describe("Artifact Content removal through Terminal Cleanup", () => {
  it.effect(
    "removes all and only the exact Closed Change's Validation Run content while metadata and another Change's content remain",
    () =>
      withArtifactLifecycleFixture((fixture) =>
        Effect.gen(function* () {
          const closed = yield* fixture.changes.cancelChange({
            changeId: fixture.first.changeId,
            reason: "Stop",
            now,
          });
          if (!closed.ok) throw new Error(closed.code);

          const cleanup = openTerminalCleanup({
            persistence: fixture.changes,
            cleanup: () => ({ state: "complete", blockingReason: null }),
            artifactLifecycle: openArtifactLifecycle({
              persistence: fixture.validation,
              artifactsRoot: fixture.artifactsRoot,
            }),
          });
          const result = yield* cleanup(closed.change, now);

          expect(result).toMatchObject({
            ok: true,
            cleanup: { state: "complete", blockingReason: null },
          });
          expect(existsSync(join(fixture.artifactsRoot, fixture.first.validationRunId))).toBe(
            false,
          );
          expect(existsSync(join(fixture.artifactsRoot, fixture.second.validationRunId))).toBe(
            true,
          );
          expect(
            existsSync(
              join(
                fixture.artifactsRoot,
                fixture.second.validationRunId,
                "checks",
                "check",
                "two.txt",
              ),
            ),
          ).toBe(true);

          const firstArtifacts = yield* fixture.validation.listArtifacts(
            fixture.first.validationRunId,
          );
          const secondArtifacts = yield* fixture.validation.listArtifacts(
            fixture.second.validationRunId,
          );
          expect(firstArtifacts.map((artifact) => artifact.ref)).toEqual([
            `artifact:${fixture.first.validationRunId}/checks/check/one.txt`,
          ]);
          expect(secondArtifacts.map((artifact) => artifact.ref)).toEqual([
            `artifact:${fixture.second.validationRunId}/checks/check/two.txt`,
          ]);
        }),
      ),
  );

  it.effect(
    "reconciles discard cleanup for an exact Closed Change with an unsupported Validation Policy Snapshot and removes only its Artifact Content",
    () =>
      withArtifactLifecycleFixture((fixture) =>
        Effect.gen(function* () {
          const repository = yield* RepositorySql;

          // Install one extra Validation Run under the selected Change whose stored
          // Validation Policy Snapshot is unsupported by the strict current decoder.
          // Its Artifact Content and metadata are real rows on disk and in SQLite.
          const unsupportedRunId = "run-unsupported";
          const unsupportedSnapshot =
            '{"checks":[],"copyFiles":[],"specialistReviews":[],"acceptanceReview":{"ok":true,"instructions":"Review.","instructionsSource":"built_in","profile":{"agentProfile":"acceptance","scope":"global","profile":{"agentRuntime":"pi"}}}}';
          yield* repository.operation(
            "install unsupported Validation Policy Snapshot",
            (sql) =>
              sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                ${unsupportedRunId}, ${fixture.first.candidateId}, ${unsupportedSnapshot}, '[]',
                NULL, 'complete', 'passed', ${now}, ${now}
              )
            `,
          );
          const unsupportedPath = join(unsupportedRunId, "checks", "check", "retired.txt");
          mkdirSync(join(fixture.artifactsRoot, unsupportedRunId, "checks", "check"), {
            recursive: true,
          });
          writeFileSync(join(fixture.artifactsRoot, unsupportedPath), "retired content\n");
          yield* fixture.validation.recordCheckRound({
            validationRunId: unsupportedRunId,
            producer: "check",
            roundNumber: 1,
            roundStatus: "passed",
            artifactRecords: [
              {
                ref: `artifact:${unsupportedRunId}/checks/check/retired.txt`,
                validationRunId: unsupportedRunId,
                phase: "checks",
                producer: "check",
                path: unsupportedPath,
                originalBytes: Buffer.byteLength("retired content\n"),
                storedBytes: Buffer.byteLength("retired content\n"),
                truncated: false,
              },
            ],
            now,
          });

          const readRawRuns = () =>
            repository.operation(
              "read raw Validation Run rows",
              (sql) =>
                sql<RawRunRow>`
                SELECT id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
                  implementation_decisions AS implementationDecisions,
                  latest_resolved_blocker_id AS latestResolvedBlockerId,
                  state, outcome, created_at AS createdAt, updated_at AS updatedAt
                FROM candidate_validation_runs
                ORDER BY id
              `,
            );
          const readRawArtifacts = () =>
            repository.operation(
              "read raw Artifact metadata rows",
              (sql) =>
                sql<RawArtifactRow>`
                SELECT ref, validation_run_id AS validationRunId, phase, producer, path,
                  original_bytes AS originalBytes, stored_bytes AS storedBytes, truncated,
                  created_at AS createdAt
                FROM candidate_validation_artifacts
                ORDER BY ref
              `,
            );
          const rawRunsBefore = yield* readRawRuns();
          const rawArtifactsBefore = yield* readRawArtifacts();

          const closed = yield* fixture.changes.cancelChange({
            changeId: fixture.first.changeId,
            reason: "Stop",
            now,
          });
          if (!closed.ok) throw new Error(closed.code);

          const reconciliation = openChangeReconciliation({
            persistence: fixture.changes,
            github: unusedGitHubGateway,
            cleanupTerminal: openTerminalCleanup({
              persistence: fixture.changes,
              cleanup: () => ({ state: "complete" }),
              artifactLifecycle: openArtifactLifecycle({
                persistence: fixture.validation,
                artifactsRoot: fixture.artifactsRoot,
              }),
            }),
          });

          const result = yield* reconciliation.reconcile({
            repositoryCommonDirectory: fixture.commonDirectory,
            changeId: fixture.first.changeId,
            now,
            discardWork: true,
          });

          expect(result).toEqual({
            rejected: false,
            changes: [
              {
                changeId: fixture.first.changeId,
                status: "cleanup_complete",
                cleanup: { state: "complete", blockingReason: null },
              },
            ],
          });

          // All and only the selected Change's Validation Run content is removed.
          expect(existsSync(join(fixture.artifactsRoot, fixture.first.validationRunId))).toBe(
            false,
          );
          expect(existsSync(join(fixture.artifactsRoot, unsupportedRunId))).toBe(false);
          expect(existsSync(join(fixture.artifactsRoot, fixture.second.validationRunId))).toBe(
            true,
          );
          expect(
            existsSync(
              join(
                fixture.artifactsRoot,
                fixture.second.validationRunId,
                "checks",
                "check",
                "two.txt",
              ),
            ),
          ).toBe(true);

          // Validation Run rows and Artifact metadata are unchanged by cleanup.
          expect(yield* readRawRuns()).toEqual(rawRunsBefore);
          expect(yield* readRawArtifacts()).toEqual(rawArtifactsBefore);

          // The unsupported Run stays rejected through both full read paths.
          const runError = yield* fixture.validation.getRunById(unsupportedRunId).pipe(Effect.flip);
          expect(runError).toBeInstanceOf(RepositoryPersistedDataInvalid);
          const historyError = yield* fixture.validation
            .listRunsForCandidate(fixture.first.candidateId)
            .pipe(Effect.flip);
          expect(historyError).toBeInstanceOf(RepositoryPersistedDataInvalid);

          // The retained Change's Run and metadata remain readable.
          expect(
            yield* fixture.validation.getRunById(fixture.second.validationRunId),
          ).toBeDefined();
          expect(
            (yield* fixture.validation.listRunsForCandidate(fixture.second.candidateId)).length,
          ).toBe(1);
          expect(
            (yield* fixture.validation.listArtifacts(fixture.second.validationRunId)).map(
              (artifact) => artifact.ref,
            ),
          ).toEqual([`artifact:${fixture.second.validationRunId}/checks/check/two.txt`]);

          const recorded = yield* fixture.changes.getChangeById(fixture.first.changeId);
          expect(recorded?.cleanup).toEqual({ state: "complete", blockingReason: null });
        }),
      ),
    30_000,
  );

  it.effect("treats already-removed Artifact Content as success on retry", () =>
    withArtifactLifecycleFixture((fixture) =>
      Effect.gen(function* () {
        const lifecycle = openArtifactLifecycle({
          persistence: fixture.validation,
          artifactsRoot: fixture.artifactsRoot,
        });

        expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: true });
        expect(existsSync(join(fixture.artifactsRoot, fixture.first.validationRunId))).toBe(false);

        expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: true });
        expect(existsSync(join(fixture.artifactsRoot, fixture.first.validationRunId))).toBe(false);
        expect(existsSync(join(fixture.artifactsRoot, fixture.second.validationRunId))).toBe(true);
      }),
    ),
  );

  it.effect.skipIf(process.getuid?.() === 0)(
    "reports failure when Artifact Content removal cannot complete and succeeds after repair",
    () =>
      withArtifactLifecycleFixture((fixture) =>
        Effect.gen(function* () {
          const lifecycle = openArtifactLifecycle({
            persistence: fixture.validation,
            artifactsRoot: fixture.artifactsRoot,
          });
          const runDirectory = join(fixture.artifactsRoot, fixture.first.validationRunId);

          // A directory without write permission makes the removal fail deterministically.
          chmodSync(runDirectory, 0o500);
          expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: false });
          chmodSync(runDirectory, 0o700);

          expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: true });
          expect(existsSync(runDirectory)).toBe(false);
          expect(
            yield* fixture.validation.listArtifacts(fixture.first.validationRunId),
          ).toHaveLength(1);
        }),
      ),
  );
});

describe("Artifact Content removal safety", () => {
  it.effect("refuses to delete a Validation Run content directory outside the Artifact root", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const artifactsRoot = join(root, "artifacts");
      mkdirSync(artifactsRoot, { recursive: true });
      const outside = join(artifactsRoot, "..", "outside");
      mkdirSync(outside, { recursive: true });
      const keptPath = join(outside, "keep.txt");
      writeFileSync(keptPath, "preserve this file\n");

      const lifecycle = openArtifactLifecycle({
        persistence: {
          listRunIdsForChange: () => Effect.succeed(["../outside"]),
        },
        artifactsRoot,
      });

      expect(yield* lifecycle.removeContent("change-1")).toEqual({ ok: false });
      expect(existsSync(keptPath)).toBe(true);
    }),
  );
});

const withArtifactLifecycleFixture = <A, E>(
  use: (fixture: {
    readonly root: string;
    readonly commonDirectory: string;
    readonly artifactsRoot: string;
    readonly changes: ChangePersistence;
    readonly validation: ChangeValidationPersistence;
    readonly first: {
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly path: string;
    };
    readonly second: {
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly path: string;
    };
  }) => Effect.Effect<A, E, RepositorySql>,
): Effect.Effect<A, E | RepositoryStorageError> =>
  Effect.gen(function* () {
    const root = yield* cloneInitializedTestRepository(candidateValidationRepoTemplate);
    const commonDirectory = join(root, ".git");
    const artifactsRoot = join(commonDirectory, "but-why", "artifacts");
    const repositoryLayer = repositorySqlLayer({
      statePath: join(commonDirectory, "but-why", "state.sqlite"),
      commonDirectory,
    });
    return yield* Effect.gen(function* () {
      const capture = yield* openSqliteCandidateCapturePersistence();
      const changes = yield* openSqliteChangePersistence();
      const validation = yield* openSqliteChangeValidationPersistence();

      const createChangeWithRun = (branchRef: string, marker: string) =>
        Effect.gen(function* () {
          const captured = yield* capture.commitCapture({
            repositoryCommonDirectory: commonDirectory,
            branchRef,
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "target-sha",
            headSha: `head-${marker}`,
            now,
          });
          if (!captured.ok) throw new Error(captured.code);
          const started = yield* validation.startOrReuse({
            candidateId: captured.candidateId,
            headSha: `head-${marker}`,
            policy,
            now,
          });
          if (started.reused || "blocked" in started)
            throw new Error("Expected a new Validation Run");
          const path = join(started.validationRunId, "checks", "check", `${marker}.txt`);
          mkdirSync(join(artifactsRoot, started.validationRunId, "checks", "check"), {
            recursive: true,
          });
          writeFileSync(join(artifactsRoot, path), `content-${marker}\n`);
          yield* validation.recordCheckRound({
            validationRunId: started.validationRunId,
            producer: "check",
            roundNumber: 1,
            roundStatus: "passed",
            artifactRecords: [
              {
                ref: `artifact:${started.validationRunId}/checks/check/${marker}.txt`,
                validationRunId: started.validationRunId,
                phase: "checks",
                producer: "check",
                path,
                originalBytes: Buffer.byteLength(`content-${marker}\n`),
                storedBytes: Buffer.byteLength(`content-${marker}\n`),
                truncated: false,
              },
            ],
            now,
          });
          return {
            changeId: captured.changeId,
            candidateId: captured.candidateId,
            validationRunId: started.validationRunId,
            path,
          };
        });

      const first = yield* createChangeWithRun("refs/heads/feature-one", "one");
      const second = yield* createChangeWithRun("refs/heads/feature-two", "two");
      return yield* use({
        root,
        commonDirectory,
        artifactsRoot,
        changes,
        validation,
        first,
        second,
      });
    }).pipe(Effect.provide(repositoryLayer));
  });
