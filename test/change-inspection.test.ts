import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { prepareStateDatabaseSession } from "../src/init/stateDatabase.js";
import { publicTaskId } from "../src/task/taskId.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const firstNow = "2026-07-18T10:00:00.000Z";
const secondNow = "2026-07-18T10:05:00.000Z";
const commandNow = "2026-07-18T11:00:00.000Z";

describe("Change inspection CLI", () => {
  it.effect("lists open taskless Changes oldest first with their age", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const store = openSqliteChangeStore(
        prepareStateDatabaseSession({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
          migrationTimestamp: () => firstNow,
        }),
      );
      const repositoryCommonDirectory = join(root, ".git");
      const older = store.createChange({
        repositoryCommonDirectory,
        branchRef: "refs/heads/older",
        now: firstNow,
      });
      const newer = store.createChange({
        repositoryCommonDirectory,
        branchRef: "refs/heads/newer",
        now: secondNow,
      });
      if (!older.ok || !newer.ok) throw new Error("Could not create Changes");

      const result = yield* runByInProcessEffect(
        root,
        ["change", "list", "--output", "json"],
        commandNow,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        changes: [
          {
            id: older.change.id,
            taskId: null,
            state: "open",
            createdAt: firstNow,
            ageSeconds: 3_600,
          },
          {
            id: newer.change.id,
            taskId: null,
            state: "open",
            createdAt: secondNow,
            ageSeconds: 3_300,
          },
        ],
      });
    }),
  );

  it.effect("includes closed Changes only when --all is explicit", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const store = openSqliteChangeStore(
        prepareStateDatabaseSession({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
          migrationTimestamp: () => firstNow,
        }),
      );
      const created = store.createChange({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef: "refs/heads/closed",
        now: firstNow,
      });
      if (!created.ok) throw new Error("Could not create Change");
      store.closeChange({ changeId: created.change.id, reason: "cancelled", now: secondNow });

      const defaultResult = yield* runByInProcessEffect(root, [
        "change",
        "list",
        "--output",
        "json",
      ]);
      const allResult = yield* runByInProcessEffect(root, [
        "change",
        "list",
        "--all",
        "--output",
        "json",
      ]);

      expect(JSON.parse(defaultResult.stdout)).toEqual({ changes: [] });
      expect(JSON.parse(allResult.stdout)).toEqual({
        changes: [{ id: created.change.id, taskId: null, state: "closed", createdAt: firstNow }],
      });
    }),
  );

  it.effect("shows taskless Change facts while preserving unavailable Candidate detail", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const store = openSqliteChangeStore(
        prepareStateDatabaseSession({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
          migrationTimestamp: () => firstNow,
        }),
      );
      const created = store.createChange({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef: "refs/heads/taskless",
        now: firstNow,
      });
      if (!created.ok) throw new Error("Could not create Change");

      const result = yield* runByInProcessEffect(root, [
        "change",
        "show",
        created.change.id,
        "--output",
        "json",
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        change: {
          id: created.change.id,
          taskId: null,
          state: "open",
          readiness: null,
          branchRef: "refs/heads/taskless",
          baseRef: null,
          worktreePath: null,
          startingCommit: null,
          createdAt: firstNow,
          closedAt: null,
        },
        currentCandidate: null,
        currentValidationRun: null,
        findings: [],
        toolingFailures: [],
        pullRequest: null,
        cleanup: { state: "complete", blockingReason: null },
      });
    }),
  );

  it.effect("removes Task-owned inspection routes", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createInitializedRepo(), [
        "task",
        "findings",
        "BY-1",
        "--output",
        "json",
      ]);

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "unknown_command" },
        help: ["Run `by task --help`."],
      });
    }),
  );

  it.effect("projects linked Change progress through Task inspection", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      commitButWhyConfigAndRecordDefault(root);
      const taskStore = openSqliteTaskStore({
        ...prepareStateDatabaseSession({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
          migrationTimestamp: () => firstNow,
        }),
        taskPrefix: "BY",
      });
      taskStore.createTask({
        title: "Task-backed Change",
        description: "Inspect progress",
        now: firstNow,
      });
      taskStore.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow });

      const started = yield* runByInProcessEffect(root, [
        "change",
        "start",
        "--task",
        "BY-1",
        "--output",
        "json",
      ]);
      const changeId = JSON.parse(started.stdout).change.id;
      const shown = yield* runByInProcessEffect(root, ["task", "show", "BY-1", "--output", "json"]);

      expect(started.status).toBe(0);
      expect(shown.status).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        task: {
          id: "BY-1",
          title: "Task-backed Change",
          description: "Inspect progress",
          state: "implementing",
          change: { id: changeId, state: "open", readiness: "ready" },
        },
      });
    }),
  );

  it.effect("inspects Findings and Validation Run History through the current Candidate", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const database = prepareStateDatabaseSession({
        statePath: join(root, ".git", "but-why", "state.sqlite"),
        migrationTimestamp: () => firstNow,
      });
      const changeStore = openSqliteChangeStore(database);
      const candidateStore = openSqliteCandidateStore(database);
      const runStore = openSqliteCandidateValidationRunStore(database);
      const changeResult = changeStore.createChange({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef: "refs/heads/validated",
        now: firstNow,
      });
      if (!changeResult.ok) throw new Error("Could not create Change");
      const candidateResult = candidateStore.captureCandidate({
        changeId: changeResult.change.id,
        selectedBaseRef: "refs/remotes/origin/main",
        resolvedTargetSha: "target-sha",
        comparisonBaseSha: "base-sha",
        headSha: "head-sha",
        now: secondNow,
      });
      if (!candidateResult.ok) throw new Error("Could not capture Candidate");
      const run = runStore.startOrReuse({
        candidateId: candidateResult.candidate.id,
        headSha: "head-sha",
        policy: { sandboxMode: "none", checks: [], copyFiles: [] },
        now: secondNow,
      });
      if (run.reused) throw new Error("Expected a new Validation Run");
      runStore.complete({
        validationRunId: run.validationRunId,
        outcome: "passed",
        now: commandNow,
      });

      const findings = yield* runByInProcessEffect(root, [
        "change",
        "findings",
        changeResult.change.id,
        "--output",
        "json",
      ]);
      const history = yield* runByInProcessEffect(root, [
        "change",
        "validation-runs",
        changeResult.change.id,
        "--output",
        "json",
      ]);

      expect(findings.status).toBe(0);
      expect(JSON.parse(findings.stdout)).toMatchObject({
        change: { id: changeResult.change.id },
        candidate: { id: candidateResult.candidate.id },
        validationRun: { id: run.validationRunId, outcome: "passed" },
        findings: [],
        toolingFailures: [],
        count: 0,
      });
      expect(history.status).toBe(0);
      expect(JSON.parse(history.stdout)).toMatchObject({
        validationRuns: [{ id: run.validationRunId, candidateId: candidateResult.candidate.id }],
      });
    }),
  );
});
