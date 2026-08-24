import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import { openArtifactLifecycle } from "../../src/change/validationRun/artifactLifecycle.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import {
  RepositorySql,
  repositorySqlLayer,
} from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import {
  type ChangeTestDependencies,
  openSqliteChangeTestDependencies,
} from "../support/changePorts.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import {
  noOpTerminalCleanupDependencies,
  openTerminalCleanup,
} from "../support/terminalCleanup.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-08-05T10:00:00.000Z";

const openArtifactLifecycleForTest = (
  dependencies: Parameters<typeof openArtifactLifecycle>[0],
) => {
  const lifecycle = openArtifactLifecycle(dependencies);
  return {
    removeContent: (changeId: string) =>
      lifecycle.removeContent(changeId).pipe(Effect.provide(NodeFileSystem.layer)),
  };
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
          const closed = yield* fixture.changes.delivery.cancelChange({
            changeId: fixture.first.changeId,
            reason: "Stop",
            now,
          });
          if (!closed.ok) throw new Error(closed.code);

          const cleanup = openTerminalCleanup({
            ...noOpTerminalCleanupDependencies,
            persistence: {
              recordCleanup: fixture.changes.delivery.recordCleanup,
            },
            cleanup: () => ({ state: "complete", blockingReason: null }),
            artifactLifecycle: openArtifactLifecycleForTest({
              persistence: fixture.validation.artifacts,
              artifactsRoot: fixture.artifactsRoot,
            }),
          });
          const result = yield* cleanup(closed.change, now);

          expect(result).toMatchObject({
            ok: true,
            cleanup: { state: "complete", blockingReason: null },
          });
          expect(
            existsSync(join(fixture.artifactsRoot, String(fixture.first.validationRunId))),
          ).toBe(false);
          expect(
            existsSync(join(fixture.artifactsRoot, String(fixture.second.validationRunId))),
          ).toBe(true);
          expect(
            existsSync(
              join(
                fixture.artifactsRoot,
                String(fixture.second.validationRunId),
                "checks",
                "check",
                "two.txt",
              ),
            ),
          ).toBe(true);

          const firstArtifacts = yield* fixture.validation.reads.listArtifacts(
            fixture.first.validationRunId,
          );
          const secondArtifacts = yield* fixture.validation.reads.listArtifacts(
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

  it.effect("treats already-removed Artifact Content as success on retry", () =>
    withArtifactLifecycleFixture((fixture) =>
      Effect.gen(function* () {
        const lifecycle = openArtifactLifecycleForTest({
          persistence: fixture.validation.artifacts,
          artifactsRoot: fixture.artifactsRoot,
        });

        expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: true });
        expect(existsSync(join(fixture.artifactsRoot, String(fixture.first.validationRunId)))).toBe(
          false,
        );

        expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: true });
        expect(existsSync(join(fixture.artifactsRoot, String(fixture.first.validationRunId)))).toBe(
          false,
        );
        expect(
          existsSync(join(fixture.artifactsRoot, String(fixture.second.validationRunId))),
        ).toBe(true);
      }),
    ),
  );

  it.effect.skipIf(process.getuid?.() === 0)(
    "reports failure when Artifact Content removal cannot complete and succeeds after repair",
    () =>
      withArtifactLifecycleFixture((fixture) =>
        Effect.gen(function* () {
          const lifecycle = openArtifactLifecycleForTest({
            persistence: fixture.validation.artifacts,
            artifactsRoot: fixture.artifactsRoot,
          });
          const runDirectory = join(fixture.artifactsRoot, String(fixture.first.validationRunId));

          // A directory without write permission makes the removal fail deterministically.
          chmodSync(runDirectory, 0o500);
          expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: false });
          chmodSync(runDirectory, 0o700);

          expect(yield* lifecycle.removeContent(fixture.first.changeId)).toEqual({ ok: true });
          expect(existsSync(runDirectory)).toBe(false);
          expect(
            yield* fixture.validation.reads.listArtifacts(fixture.first.validationRunId),
          ).toHaveLength(1);
        }),
      ),
  );
});

const withArtifactLifecycleFixture = <A, E>(
  use: (fixture: {
    readonly root: string;
    readonly commonDirectory: string;
    readonly artifactsRoot: string;
    readonly changes: ChangeTestDependencies;
    readonly validation: ChangeValidationTestDependencies;
    readonly first: {
      readonly changeId: string;
      readonly candidateId: number;
      readonly validationRunId: number;
      readonly path: string;
    };
    readonly second: {
      readonly changeId: string;
      readonly candidateId: number;
      readonly validationRunId: number;
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
      const changes = yield* openSqliteChangeTestDependencies();
      const validation = yield* openSqliteChangeValidationTestDependencies();

      const createChangeWithRun = (branchRef: string, marker: string) =>
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "create Candidate-owning Change",
            (sql) => sql`
            INSERT INTO changes (
              branch_ref, base_ref, base_remote_url, worktree_path,
              reviewer_configuration, stall_detection_definition, checks_definition, cleanup_pending
            ) VALUES (
              ${branchRef}, 'refs/remotes/origin/main',
              'https://example.com/acme/repo.git', ${`/tmp/${marker}`},
              '{"acceptanceReview":null,"specialistReviews":[]}', '{"enabled":false,"profile":null}',
              '[{"id":"check","command":"true","timeoutSeconds":10}]', 0
            )
          `,
          );
          const captured = yield* capture.commitCapture({
            repositoryCommonDirectory: commonDirectory,
            branchRef,
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "target-sha",
            headSha: `head-${marker}`,
          });
          if (!captured.ok) throw new Error(captured.code);
          const started = yield* validation.execution.startOrReuse({
            candidateId: captured.candidateId,
            headSha: `head-${marker}`,
          });
          if (started.reused || "blocked" in started)
            throw new Error("Expected a new Validation Run");
          const path = join(String(started.validationRunId), "checks", "check", `${marker}.txt`);
          mkdirSync(join(artifactsRoot, String(started.validationRunId), "checks", "check"), {
            recursive: true,
          });
          writeFileSync(join(artifactsRoot, path), `content-${marker}\n`);
          yield* validation.execution.recordCheckResult({
            validationRunId: started.validationRunId,
            producer: "check",
            outcome: "passed",
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
