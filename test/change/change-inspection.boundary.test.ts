import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import { publicTaskId } from "../../src/task/taskId.js";
import { openSqliteChangeCandidateCapturePersistence } from "../../src/sqlite/sqliteChangeCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import type { ChangeValidationPersistence } from "../../src/changeValidation/changeValidationPersistence.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { commitButWhyConfigAndRecordDefault, runByInProcessEffect } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import {
  acquireTestWorkspace,
  cloneInitializedTestRepository,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const firstNow = "2026-07-18T10:00:00.000Z";
const secondNow = "2026-07-18T10:05:00.000Z";
const commandNow = "2026-07-18T11:00:00.000Z";
let initializedRepoTemplate: string;

beforeAll(() => {
  initializedRepoTemplate = acquireTestWorkspace();
  createInitializedRepo(initializedRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(initializedRepoTemplate);
});

const initializedRepoCopy = () => cloneInitializedTestRepository(initializedRepoTemplate);

describe("Change inspection CLI", () => {
  it.effect("lists open Changes by age, filters closed Changes, and shows taskless facts", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      const older = yield* createChangeFixture(root, "refs/heads/older", firstNow);
      const newer = yield* createChangeFixture(root, "refs/heads/newer", secondNow);
      yield* closeChangeFixture(root, newer.id, "cancelled", secondNow);

      const defaultResult = yield* runByInProcessEffect(
        root,
        ["change", "list", "--output", "json"],
        commandNow,
      );
      const allResult = yield* runByInProcessEffect(
        root,
        ["change", "list", "--all", "--output", "json"],
        commandNow,
      );
      const openShown = yield* runByInProcessEffect(root, [
        "change",
        "show",
        older.id,
        "--output",
        "json",
      ]);
      const closedShown = yield* runByInProcessEffect(root, [
        "change",
        "show",
        newer.id,
        "--output",
        "json",
      ]);

      expect(JSON.parse(defaultResult.stdout)).toEqual({
        changes: [
          {
            id: older.id,
            taskId: null,
            state: "open",
            createdAt: firstNow,
            ageSeconds: 3_600,
          },
        ],
      });
      expect(
        JSON.parse(allResult.stdout).changes.map((change: { readonly id: string }) => change.id),
      ).toEqual([older.id, newer.id]);
      expect(JSON.parse(openShown.stdout)).toEqual({
        change: {
          id: older.id,
          taskId: null,
          state: "open",
          closeReason: null,
          readiness: null,
          branchRef: "refs/heads/older",
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
      expect(JSON.parse(closedShown.stdout)).toMatchObject({
        change: { state: "closed", closeReason: "cancelled" },
        cleanup: { state: "pending", blockingReason: null },
      });
    }),
  );

  it.effect("inspects current Findings and orders Validation Run History across Candidates", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      const change = yield* createChangeFixture(root, "refs/heads/history", firstNow);
      const firstCandidate = yield* captureCandidateFixture(
        root,
        change.id,
        "refs/heads/history",
        "first-head",
        firstNow,
      );
      const secondCandidate = yield* captureCandidateFixture(
        root,
        change.id,
        "refs/heads/history",
        "second-head",
        secondNow,
      );
      const newerRun = yield* withValidationPersistence(root, (persistence) =>
        persistence.startOrReuse({
          candidateId: secondCandidate.id,
          headSha: secondCandidate.headSha,
          policy: { sandboxMode: "none", checks: [], copyFiles: [] },
          now: secondNow,
        }),
      );
      const olderCandidateRun = yield* withValidationPersistence(root, (persistence) =>
        persistence.startOrReuse({
          candidateId: firstCandidate.id,
          headSha: firstCandidate.headSha,
          policy: { sandboxMode: "none", checks: [], copyFiles: [] },
          now: commandNow,
        }),
      );
      if (newerRun.reused || olderCandidateRun.reused)
        throw new Error("Expected new Validation Runs");
      yield* withValidationPersistence(root, (persistence) =>
        persistence.recordCheckRound({
          validationRunId: newerRun.validationRunId,
          producer: "types",
          roundNumber: 1,
          roundStatus: "failed",
          phaseStatus: "failed",
          artifactRecords: [],
          finding: {
            id: `${newerRun.validationRunId}-F1`,
            validationRunId: newerRun.validationRunId,
            phase: "checks",
            producer: "types",
            title: "Check failed: types",
            description: "Type checking failed.",
            evidence: "exitCode: 1",
            files: ["src/main.ts"],
            artifactRefs: [],
          },
          now: commandNow,
        }),
      );
      yield* withValidationPersistence(root, (persistence) =>
        persistence.recordToolingFailure({
          validationRunId: newerRun.validationRunId,
          errorKind: "validation_workspace_setup_failed",
          operationName: "cleanup_validation_worktree",
          errorMessage: "Could not remove worktree.",
          now: commandNow,
        }),
      );
      yield* withValidationPersistence(root, (persistence) =>
        persistence.complete({
          validationRunId: newerRun.validationRunId,
          outcome: "blocked",
          now: commandNow,
        }),
      );

      const findings = yield* runByInProcessEffect(root, [
        "change",
        "findings",
        change.id,
        "--output",
        "json",
      ]);
      const history = yield* runByInProcessEffect(root, [
        "change",
        "validation-runs",
        change.id,
        "--output",
        "json",
      ]);

      expect(JSON.parse(findings.stdout)).toMatchObject({
        change: { id: change.id },
        candidate: { id: secondCandidate.id },
        validationRun: { id: newerRun.validationRunId, outcome: "blocked" },
        findings: [{ id: `${newerRun.validationRunId}-F1`, files: ["src/main.ts"] }],
        toolingFailures: [{ operationName: "cleanup_validation_worktree" }],
        count: 1,
      });
      expect(
        JSON.parse(history.stdout).validationRuns.map((run: { id: string }) => run.id),
      ).toEqual([newerRun.validationRunId, olderCandidateRun.validationRunId]);
    }),
  );

  it.effect("rejects a remote Task comment before requiring local state", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      writeFileSync(join(root, "comment.md"), "Valid comment");
      rmSync(join(root, ".git", "but-why", "state.sqlite"));

      const result = yield* runByInProcessEffect(root, [
        "task",
        "comment",
        "linear/ENG-123:acceptance",
        "--file",
        "comment.md",
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: remote_tasks_not_supported");
    }),
  );

  it.effect("keeps an unchanged taskless Change open with explicit cancellation guidance", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      commitButWhyConfigAndRecordDefault(root);
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--output", "json"],
        firstNow,
      );
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };

      const result = yield* runByInProcessEffect(
        root,
        ["change", "submit", change.change.id, "--output", "json"],
        firstNow,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        changeId: change.change.id,
        status: "nothing_to_submit",
        help: [`Run \`by change cancel ${change.change.id}\` to cancel this unchanged Change.`],
      });
    }),
  );

  it.effect("projects linked Change progress through Task inspection", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepoCopy();
      commitButWhyConfigAndRecordDefault(root);
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const tasks = yield* openSqliteTaskPersistence("BY");
          const created = yield* tasks.createTask({
            title: "Task-backed Change",
            description: "Inspect progress",
            now: firstNow,
          });
          if (!created.ok) throw new Error(created.code);
          const approved = yield* tasks.approveTask({
            taskId: publicTaskId("BY-1"),
            now: secondNow,
          });
          if (!approved.ok) throw new Error(approved.code);
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

      yield* transitionTaskFixture(root, "validating");
      expect(
        JSON.parse(
          (yield* runByInProcessEffect(root, ["task", "show", "BY-1", "--output", "json"])).stdout,
        ).task.state,
      ).toBe("validating");

      yield* transitionTaskFixture(root, "ready");
      expect(
        JSON.parse(
          (yield* runByInProcessEffect(root, ["task", "show", "BY-1", "--output", "json"])).stdout,
        ).task.state,
      ).toBe("ready");

      yield* completeChangeFixture(root, changeId);
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
});

const createChangeFixture = (root: string, branchRef: string, createdAt: string) => {
  const id = randomUUID();
  return withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Change fixture",
        (sql) => sql`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, task_id, state,
          close_reason, created_at, updated_at, closed_at
        ) VALUES (
          ${id}, ${join(root, ".git")}, ${branchRef}, NULL, 'open',
          NULL, ${createdAt}, ${createdAt}, NULL
        )
      `,
      );
      return { id };
    }),
  );
};

const closeChangeFixture = (
  root: string,
  changeId: string,
  reason: "cancelled" | "completed",
  closedAt: string,
) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "close Change fixture",
        (sql) => sql`
        UPDATE changes
        SET
          state = 'closed',
          close_reason = ${reason},
          closed_at = ${closedAt},
          updated_at = ${closedAt},
          cleanup_state = 'pending'
        WHERE id = ${changeId}
      `,
      );
    }),
  );

const captureCandidateFixture = (
  root: string,
  changeId: string,
  branchRef: string,
  headSha: string,
  capturedAt: string,
) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const capture = yield* openSqliteChangeCandidateCapturePersistence();
      const result = yield* capture.commitCapture({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef,
        expectedChangeId: changeId,
        selectedBaseRef: "refs/remotes/origin/main",
        resolvedTargetSha: "target-sha",
        comparisonBaseSha: "base-sha",
        headSha,
        now: capturedAt,
      });
      if (!result.ok) throw new Error(result.code);
      return { id: result.candidateId, headSha };
    }),
  );

const transitionTaskFixture = (root: string, state: "validating" | "ready") =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const result = yield* tasks.transitionTaskState({
        taskId: publicTaskId("BY-1"),
        to: state,
        now: commandNow,
      });
      if (!result.ok) throw new Error(result.code);
    }),
  );

const completeChangeFixture = (root: string, changeId: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const changes = yield* openSqliteChangePersistence();
      const result = yield* changes.completeMergedChange({ changeId, now: commandNow });
      if (!result.ok) throw new Error(result.code);
    }),
  );

const withValidationPersistence = <A, E>(
  root: string,
  use: (persistence: ChangeValidationPersistence) => Effect.Effect<A, E>,
) =>
  Effect.flatMap(openSqliteChangeValidationPersistence(), use).pipe(
    Effect.provide(
      repositorySqlLayer({
        statePath: join(root, ".git", "but-why", "state.sqlite"),
        commonDirectory: join(root, ".git"),
      }),
    ),
  );
