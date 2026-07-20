import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { prepareStateDatabase } from "../src/init/stateDatabase.js";
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
        prepareStateDatabase({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
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
        prepareStateDatabase({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
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
      const shown = yield* runByInProcessEffect(root, [
        "change",
        "show",
        created.change.id,
        "--output",
        "json",
      ]);

      expect(JSON.parse(defaultResult.stdout)).toEqual({ changes: [] });
      expect(JSON.parse(allResult.stdout)).toEqual({
        changes: [{ id: created.change.id, taskId: null, state: "closed", createdAt: firstNow }],
      });
      expect(JSON.parse(shown.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "cancelled" },
        cleanup: { state: "pending", blockingReason: null },
      });
    }),
  );

  it.effect("shows taskless Change facts while preserving unavailable Candidate detail", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const store = openSqliteChangeStore(
        prepareStateDatabase({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
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
          closeReason: null,
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

  it.effect("orders Validation Run History by run creation across Candidates", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const database = prepareStateDatabase({
        statePath: join(root, ".git", "but-why", "state.sqlite"),
      });
      const changeStore = openSqliteChangeStore(database);
      const candidateStore = openSqliteCandidateStore(database);
      const runStore = openSqliteCandidateValidationRunStore(database);
      const change = changeStore.createChange({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef: "refs/heads/history",
        now: firstNow,
      });
      if (!change.ok) throw new Error("Could not create Change");
      const firstCandidate = candidateStore.captureCandidate({
        changeId: change.change.id,
        selectedBaseRef: "refs/remotes/origin/main",
        resolvedTargetSha: "target-sha",
        comparisonBaseSha: "base-sha",
        headSha: "first-head",
        now: firstNow,
      });
      const secondCandidate = candidateStore.captureCandidate({
        changeId: change.change.id,
        selectedBaseRef: "refs/remotes/origin/main",
        resolvedTargetSha: "target-sha",
        comparisonBaseSha: "base-sha",
        headSha: "second-head",
        now: secondNow,
      });
      if (!firstCandidate.ok || !secondCandidate.ok)
        throw new Error("Could not capture Candidates");
      const newerRun = runStore.startOrReuse({
        candidateId: secondCandidate.candidate.id,
        headSha: secondCandidate.candidate.headSha,
        policy: { sandboxMode: "none", checks: [], copyFiles: [] },
        now: secondNow,
      });
      const olderCandidateRun = runStore.startOrReuse({
        candidateId: firstCandidate.candidate.id,
        headSha: firstCandidate.candidate.headSha,
        policy: { sandboxMode: "none", checks: [], copyFiles: [] },
        now: commandNow,
      });
      if (newerRun.reused || olderCandidateRun.reused)
        throw new Error("Expected new Validation Runs");

      const history = yield* runByInProcessEffect(root, [
        "change",
        "validation-runs",
        change.change.id,
        "--output",
        "json",
      ]);

      expect(
        JSON.parse(history.stdout).validationRuns.map((run: { id: string }) => run.id),
      ).toEqual([newerRun.validationRunId, olderCandidateRun.validationRunId]);
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
        ...prepareStateDatabase({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
        }),
        taskPrefix: "BY",
      });
      taskStore.createTask({
        title: "Task-backed Change",
        description: "Inspect progress",
        now: firstNow,
      });
      taskStore.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow });
      const changeStore = openSqliteChangeStore(
        prepareStateDatabase({
          statePath: join(root, ".git", "but-why", "state.sqlite"),
        }),
      );

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
      expect(
        JSON.parse(
          (yield* runByInProcessEffect(root, ["task", "list", "--all", "--output", "json"])).stdout,
        ).tasks,
      ).toContainEqual(
        expect.objectContaining({
          id: "BY-1",
          change: { id: changeId, state: "open", readiness: "ready" },
        }),
      );

      taskStore.transitionTaskState({
        taskId: publicTaskId("BY-1"),
        to: "validating",
        now: commandNow,
      });
      expect(
        JSON.parse(
          (yield* runByInProcessEffect(root, ["task", "show", "BY-1", "--output", "json"])).stdout,
        ).task.state,
      ).toBe("validating");

      taskStore.transitionTaskState({
        taskId: publicTaskId("BY-1"),
        to: "ready",
        now: commandNow,
      });
      expect(
        JSON.parse(
          (yield* runByInProcessEffect(root, ["task", "show", "BY-1", "--output", "json"])).stdout,
        ).task.state,
      ).toBe("ready");

      changeStore.completeMergedChange({ changeId, now: commandNow });
      const completed = yield* runByInProcessEffect(root, [
        "change",
        "show",
        changeId,
        "--output",
        "json",
      ]);
      expect(JSON.parse(completed.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "completed" },
        cleanup: { state: "pending", blockingReason: null },
      });
      expect(
        JSON.parse(
          (yield* runByInProcessEffect(root, ["task", "show", "BY-1", "--output", "json"])).stdout,
        ).task.state,
      ).toBe("done");
    }),
  );

  it.effect("inspects Findings and Validation Run History through the current Candidate", () =>
    Effect.gen(function* () {
      const root = createInitializedRepo();
      const database = prepareStateDatabase({
        statePath: join(root, ".git", "but-why", "state.sqlite"),
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
      runStore.recordCheckRound({
        validationRunId: run.validationRunId,
        producer: "types",
        roundNumber: 1,
        roundStatus: "failed",
        phaseStatus: "failed",
        artifactRecords: [],
        finding: {
          id: `${run.validationRunId}-F1`,
          validationRunId: run.validationRunId,
          phase: "checks",
          producer: "types",
          title: "Check failed: types",
          description: "Type checking failed.",
          evidence: "exitCode: 1",
          files: ["src/main.ts"],
          artifactRefs: [],
        },
        now: commandNow,
      });
      runStore.recordToolingFailure({
        validationRunId: run.validationRunId,
        errorKind: "validation_workspace_setup_failed",
        operationName: "cleanup_validation_worktree",
        errorMessage: "Could not remove worktree.",
        now: commandNow,
      });
      runStore.complete({
        validationRunId: run.validationRunId,
        outcome: "blocked",
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
        validationRun: { id: run.validationRunId, outcome: "blocked" },
        findings: [
          {
            id: `${run.validationRunId}-F1`,
            files: ["src/main.ts"],
          },
        ],
        toolingFailures: [{ operationName: "cleanup_validation_worktree" }],
        count: 1,
      });
      expect(history.status).toBe(0);
      expect(JSON.parse(history.stdout)).toMatchObject({
        validationRuns: [{ id: run.validationRunId, candidateId: candidateResult.candidate.id }],
      });
    }),
  );
});
