import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openSqliteValidationRunStore } from "../src/sqlite/sqliteValidationRunStore.js";
import { openSqliteValidationRuns } from "../src/sqlite/sqliteValidationRuns.js";
import { publicTaskId } from "../src/task/taskId.js";
import type { RecordValidationRunCheckRoundInput } from "../src/validationRun/validationRunStore.js";
import { cleanupTempRoots, createGitRepo, runByInProcess } from "./support/by-cli.js";

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
  it("returns an empty latest findings read for a known Task with no Validation Run History", () => {
    const root = initializedRepo();

    createTask(root, "No history");

    const result = runByInProcess(root, ["task", "findings", "BY-1", "--output", "json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      task: {
        id: "BY-1",
        title: "No history",
        state: "todo",
      },
      validationRun: null,
      findings: [],
      toolingFailures: [],
      count: 0,
    });
  });

  it("shows latest Task findings without falling back and includes only latest tooling failures", () => {
    const root = initializedRepo();

    createTask(root, "Inspect findings");
    startTask(root, "BY-1", secondNow);
    const olderRunId = startValidationRun(root, "BY-1", "aaa111", thirdNow);
    recordFailedCheckRound(root, olderRunId, "quality", thirdNow);
    const latestRunId = startValidationRun(root, "BY-1", "bbb222", fourthNow);
    recordToolingFailure(root, latestRunId, fourthNow);

    const result = runByInProcess(root, ["task", "findings", "BY-1", "--output", "json"]);

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
  });

  it("lists Task Validation Run History newest first with summary counts", () => {
    const root = initializedRepo();

    createTask(root, "Run history");
    startTask(root, "BY-1", secondNow);
    const olderRunId = startValidationRun(root, "BY-1", "aaa111", thirdNow);
    recordFailedCheckRound(root, olderRunId, "quality", thirdNow);
    const latestRunId = startValidationRun(root, "BY-1", "bbb222", fourthNow);
    recordToolingFailure(root, latestRunId, fourthNow);

    const result = runByInProcess(root, ["task", "validation-runs", "BY-1", "--output", "json"]);

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
  });

  it("shows full Validation Run details with finding sources and artifact metadata", () => {
    const root = initializedRepo();

    createTask(root, "Show run");
    startTask(root, "BY-1", secondNow);
    const validationRunId = startValidationRun(root, "BY-1", "aaa111", thirdNow);
    recordFailedCheckRound(root, validationRunId, "quality", thirdNow);

    const result = runByInProcess(root, [
      "validation-run",
      "show",
      validationRunId,
      "--output",
      "json",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      validationRun: {
        id: validationRunId,
        taskId: "BY-1",
        taskValidationNumber: 1,
        status: "failed",
        branch: "feature/BY-1",
        commit: "aaa111",
        createdAt: thirdNow,
        updatedAt: thirdNow,
      },
      phases: [
        {
          validationRunId,
          phase: "checks",
          status: "failed",
          errorMessage: null,
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ],
      rounds: [
        {
          validationRunId,
          phase: "checks",
          roundNumber: 1,
          status: "failed",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ],
      findings: [
        {
          id: `${validationRunId}-F1`,
          validationRunId,
          phase: "checks",
          producer: "quality",
          source: "checks/quality",
          title: "Check failed: quality",
          description: "Configured check quality exited with code 7.",
          severity: "high",
          evidence: "command: npm test\nexitCode: 7",
          files: [],
          artifactRefs: [
            `artifact:${validationRunId}/checks/quality/stdout.txt`,
            `artifact:${validationRunId}/checks/quality/stderr.txt`,
          ],
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ],
      toolingFailures: [],
      artifacts: [
        {
          ref: `artifact:${validationRunId}/checks/quality/stdout.txt`,
          validationRunId,
          phase: "checks",
          producer: "quality",
          path: `.but-why/validation-runs/${validationRunId}/checks/quality/stdout.txt`,
          createdAt: thirdNow,
        },
        {
          ref: `artifact:${validationRunId}/checks/quality/stderr.txt`,
          validationRunId,
          phase: "checks",
          producer: "quality",
          path: `.but-why/validation-runs/${validationRunId}/checks/quality/stderr.txt`,
          createdAt: thirdNow,
        },
      ],
    });
  });

  it("reports unknown Task IDs and unknown Validation Run IDs as command errors", () => {
    const root = initializedRepo();

    const unknownTask = runByInProcess(root, ["task", "findings", "BY-999", "--output", "json"]);
    const unknownRun = runByInProcess(root, [
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
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();

  expect(runByInProcess(root, ["init", "--task-prefix", "BY"])).toMatchObject({
    status: 0,
    stderr: "",
  });

  return root;
};

const createTask = (root: string, title: string): void => {
  const descriptionPath = join(root, "task-description.md");

  writeFileSync(descriptionPath, `Description for ${title}`);
  expect(
    runByInProcess(
      root,
      ["task", "create", "--title", title, "--description-file", descriptionPath],
      firstNow,
    ),
  ).toMatchObject({ status: 0 });
};

const startTask = (root: string, id: string, now: string): void => {
  const result = runByInProcess(root, ["task", "start", id], now);

  expect(result.status).toBe(0);
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
      severity: "high",
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

const validationRuns = (root: string) =>
  openSqliteValidationRuns({
    statePath: join(root, ".but-why/state.sqlite"),
    migrationTimestamp: () => firstNow,
  });

const validationRunsStore = (root: string) =>
  openSqliteValidationRunStore({
    statePath: join(root, ".but-why/state.sqlite"),
    migrationTimestamp: () => firstNow,
  });
