import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, describe } from "vitest";

import { prepareStateDatabaseSession } from "../src/init/stateDatabase.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { openSqliteValidationRunStore } from "../src/sqlite/sqliteValidationRunStore.js";
import { openSqliteValidationRuns } from "../src/sqlite/sqliteValidationRuns.js";
import { publicTaskId } from "../src/task/taskId.js";
import type { RecordValidationRunCheckRoundInput } from "../src/validationRun/validationRunStore.js";
import { cleanupTempRoots, runByInProcessEffect } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const fourthNow = "2026-06-30T12:15:00.000Z";

const prTarget = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
  remoteUrl: "https://github.com/acme/widgets.git",
};

afterEach(cleanupTempRoots);

describe("Validation Run inspection CLI", () => {
  it.effect(
    "returns an empty latest findings read for a known Task with no Validation Run History",
    () =>
      Effect.gen(function* () {
        const root = initializedRepo();

        createTask(root, "No history");

        const result = yield* runByInProcessEffect(root, [
          "task",
          "findings",
          "BY-1",
          "--output",
          "json",
        ]);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          task: {
            id: "BY-1",
            title: "No history",
            state: "new",
          },
          validationRun: null,
          findings: [],
          toolingFailures: [],
          count: 0,
        });
      }),
  );

  it.effect(
    "shows latest Task findings without falling back and includes only latest tooling failures",
    () =>
      Effect.gen(function* () {
        const root = initializedRepo();

        createTask(root, "Inspect findings");
        startTask(root, "BY-1", secondNow);
        const olderRunId = startValidationRun(root, "BY-1", "aaa111", thirdNow);
        recordFailedCheckRound(root, olderRunId, "quality", thirdNow);
        const latestRunId = startValidationRun(root, "BY-1", "bbb222", fourthNow);
        recordToolingFailure(root, latestRunId, fourthNow);

        const result = yield* runByInProcessEffect(root, [
          "task",
          "findings",
          "BY-1",
          "--output",
          "json",
        ]);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          task: {
            id: "BY-1",
            title: "Inspect findings",
            state: "validating",
          },
          validationRun: {
            id: latestRunId,
            taskValidationNumber: 2,
            status: "error",
            branch: "feature/BY-1",
            commit: "bbb222",
            createdAt: fourthNow,
            updatedAt: fourthNow,
          },
          findings: [],
          toolingFailures: [
            expect.objectContaining({
              validationRunId: latestRunId,
              errorKind: "validation_workspace_setup_failed",
              operationName: "copy_allowlisted_file",
            }),
          ],
          count: 0,
        });
      }),
  );

  it.effect("lists Task Validation Run History newest first with summary counts", () =>
    Effect.gen(function* () {
      const root = initializedRepo();

      createTask(root, "Run history");
      startTask(root, "BY-1", secondNow);
      const olderRunId = startValidationRun(root, "BY-1", "aaa111", thirdNow);
      recordFailedCheckRound(root, olderRunId, "quality", thirdNow);
      const latestRunId = startValidationRun(root, "BY-1", "bbb222", fourthNow);
      recordToolingFailure(root, latestRunId, fourthNow);

      const result = yield* runByInProcessEffect(root, [
        "task",
        "validation-runs",
        "BY-1",
        "--output",
        "json",
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        validationRuns: [
          {
            id: latestRunId,
            taskValidationNumber: 2,
            status: "error",
            branch: "feature/BY-1",
            commit: "bbb222",
            findingCount: 0,
            toolingFailureCount: 1,
            createdAt: fourthNow,
            updatedAt: fourthNow,
          },
          {
            id: olderRunId,
            taskValidationNumber: 1,
            status: "failed",
            branch: "feature/BY-1",
            commit: "aaa111",
            findingCount: 1,
            toolingFailureCount: 0,
            createdAt: thirdNow,
            updatedAt: thirdNow,
          },
        ],
      });
    }),
  );

  it.effect("reports unknown Task IDs and unknown Validation Run IDs as command errors", () =>
    Effect.gen(function* () {
      const root = initializedRepo();

      const unknownTask = yield* runByInProcessEffect(root, [
        "task",
        "findings",
        "BY-999",
        "--output",
        "json",
      ]);
      const unknownRun = yield* runByInProcessEffect(root, [
        "validation-run",
        "show",
        "missing-run",
        "--output",
        "json",
      ]);

      expect(unknownTask.status).toBe(1);
      expect(JSON.parse(unknownTask.stdout).error.code).toBe("task_not_found");
      expect(unknownRun.status).toBe(1);
      expect(JSON.parse(unknownRun.stdout).error.code).toBe("validation_run_not_found");
    }),
  );
});

const initializedRepo = (): string => createInitializedRepo();

const createTask = (root: string, title: string): void => {
  taskStore(root).createTask({ title, description: `Description for ${title}`, now: firstNow });
};

const startTask = (root: string, id: string, now: string): void => {
  const store = taskStore(root);
  const taskId = publicTaskId(id);

  expect(store.approveTask({ taskId, now }).ok).toBe(true);
  expect(store.transitionTaskState({ taskId, to: "implementing", now })).toMatchObject({
    ok: true,
    changed: true,
  });
};

const startValidationRun = (
  root: string,
  taskId: string,
  commitSha: string,
  now: string,
): string => {
  const result = validationRuns(root).start({
    taskId: publicTaskId(taskId),
    branch: `feature/${taskId}`,
    commitSha,
    prTarget,
    now,
  });

  if (!result.ok) {
    throw new Error(`Could not start Validation Run: ${result.code}`);
  }

  return result.validationRunId;
};

const recordFailedCheckRound = (
  root: string,
  validationRunId: string,
  producer: string,
  now: string,
): void => {
  const artifactRefs = [
    `artifact:${validationRunId}/checks/${producer}/stdout.txt`,
    `artifact:${validationRunId}/checks/${producer}/stderr.txt`,
  ];
  const result = validationRuns(root).recordCheckRound({
    validationRunId,
    producer,
    roundNumber: 1,
    roundStatus: "failed",
    phaseStatus: "failed",
    artifactRecords: artifactRefs.map((ref) => ({
      ref,
      validationRunId,
      phase: "checks" as const,
      producer,
      path: ref.replace("artifact:", ".but-why/validation-runs/"),
    })),
    finding: {
      id: `${validationRunId}-F1`,
      validationRunId,
      phase: "checks",
      producer,
      title: `Check failed: ${producer}`,
      description: `Configured check ${producer} exited with code 7.`,
      evidence: "command: npm test\nexitCode: 7",
      files: [],
      artifactRefs,
    },
    now,
  } satisfies RecordValidationRunCheckRoundInput);

  if (!result.ok) {
    throw new Error(`Could not record check round: ${result.code}`);
  }
};

const recordToolingFailure = (root: string, validationRunId: string, now: string): void => {
  const validationRunStore = validationRunsStore(root);
  const errorResult = validationRunStore.recordValidationRunError({ validationRunId, now });

  if (!errorResult.ok) {
    throw new Error(`Could not mark Validation Run error: ${errorResult.code}`);
  }

  const toolingResult = validationRunStore.recordValidationRunToolingError({
    validationRunId,
    errorKind: "validation_workspace_setup_failed",
    operationName: "copy_allowlisted_file",
    tempRefName: `refs/but-why/validation-runs/${validationRunId}/validation`,
    submittedSha: "bbb222",
    errorMessage: "Missing allowlisted file",
    cleanupWorktree: "not_created",
    cleanupTempRef: "removed",
    now,
  });

  if (!toolingResult.ok) {
    throw new Error(`Could not record tooling failure: ${toolingResult.code}`);
  }
};

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const stateDatabase = (root: string) =>
  prepareStateDatabaseSession({
    statePath: sharedStatePath(root),
    migrationTimestamp: () => firstNow,
  });

const taskStore = (root: string) =>
  openSqliteTaskStore({ ...stateDatabase(root), taskPrefix: "BY" });

const validationRuns = (root: string) => openSqliteValidationRuns(stateDatabase(root));

const validationRunsStore = (root: string) => openSqliteValidationRunStore(stateDatabase(root));
