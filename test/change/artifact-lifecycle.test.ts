import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { CandidateRecord } from "../../src/change/candidate/candidate.js";
import type { CandidateValidationRunRecord } from "../../src/change/candidateValidation/candidateValidationRunStore.js";
import type { ChangePersistence } from "../../src/change/changePersistence.js";
import { openTerminalCleanup } from "../../src/change/cleanupTerminalChange.js";
import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { openArtifactLifecycle } from "../../src/change/validationRun/artifactLifecycle.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
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
  checks: [{ id: "test", command: "true", timeoutSeconds: 30 }],
  copyFiles: [],
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
          listCandidatesForChange: () => Effect.succeed([candidateRecord]),
          listRunsForCandidate: () =>
            Effect.succeed([{ ...validationRunRecord, id: "../outside" }]),
        },
        artifactsRoot,
      });

      expect(yield* lifecycle.removeContent("change-1")).toEqual({ ok: false });
      expect(existsSync(keptPath)).toBe(true);
    }),
  );
});

const candidateRecord: CandidateRecord = {
  id: "candidate-1",
  changeId: "change-1",
  changeBaseSha: "target-sha",
  headSha: "head-one",
  createdAt: now,
};

const validationRunRecord: CandidateValidationRunRecord = {
  id: "run-1",
  candidateId: "candidate-1",
  policy,
  implementationDecisions: [],
  state: "complete",
  outcome: "passed",
  createdAt: now,
  updatedAt: now,
};

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
  }) => Effect.Effect<A, E>,
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
