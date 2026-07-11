import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, createGitRepo, runByInProcessArgs as runBy } from "./support/by-cli.js";

const now = "2026-07-11T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("Change storage", () => {
  it("creates and reads an open Change with durable repository identity", () => {
    const root = initializedRepo();
    const store = changeStore(root);

    const result = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/feature",
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.change).toEqual({
      id: expect.any(String),
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/feature",
      taskId: null,
      state: "open",
      closeReason: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    });
    expect(store.getChangeById(result.change.id)).toEqual(result.change);
  });

  it("links one Task permanently to one Change", () => {
    const root = initializedRepo();
    const store = changeStore(root);
    const tasks = taskStore(root);
    const firstTask = tasks.createTask({ title: "First", description: "Work", now });
    const secondTask = tasks.createTask({ title: "Second", description: "Work", now });
    const created = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/feature",
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(
      store.linkTask({ changeId: created.change.id, taskId: firstTask.id, now }),
    ).toMatchObject({
      ok: true,
      changed: true,
      change: { taskId: firstTask.id },
    });
    expect(
      store.linkTask({ changeId: created.change.id, taskId: firstTask.id, now }),
    ).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(store.linkTask({ changeId: created.change.id, taskId: secondTask.id, now })).toEqual({
      ok: false,
      code: "change_already_linked_to_task",
    });
  });

  it("closes a Change permanently while preserving its branch binding", () => {
    const root = initializedRepo();
    const store = changeStore(root);
    const created = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/feature",
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const closedAt = "2026-07-11T11:00:00.000Z";
    expect(
      store.closeChange({ changeId: created.change.id, reason: "completed", now: closedAt }),
    ).toEqual({
      ok: true,
      changed: true,
      change: {
        ...created.change,
        state: "closed",
        closeReason: "completed",
        updatedAt: closedAt,
        closedAt,
      },
    });
    expect(
      store.closeChange({ changeId: created.change.id, reason: "completed", now: closedAt }),
    ).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(
      store.closeChange({ changeId: created.change.id, reason: "cancelled", now: closedAt }),
    ).toEqual({
      ok: false,
      code: "change_already_closed",
      reason: "completed",
    });
    expect(
      store.createChange({
        repositoryCommonDirectory: "/repos/example/.git",
        branchRef: "refs/heads/feature",
        now: closedAt,
      }),
    ).toEqual({ ok: false, code: "repository_branch_already_linked" });
  });

  it("enforces permanent repository branch and Task bindings", () => {
    const root = initializedRepo();
    const store = changeStore(root);
    const task = taskStore(root).createTask({ title: "Task", description: "Work", now });

    const first = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/feature",
      taskId: task.id,
      now,
    });
    expect(first.ok).toBe(true);

    expect(
      store.createChange({
        repositoryCommonDirectory: "/repos/example/.git",
        branchRef: "refs/heads/feature",
        now,
      }),
    ).toEqual({ ok: false, code: "repository_branch_already_linked" });
    expect(
      store.createChange({
        repositoryCommonDirectory: "/repos/example/.git",
        branchRef: "refs/heads/other",
        taskId: task.id,
        now,
      }),
    ).toEqual({ ok: false, code: "task_already_linked" });
  });
});

describe("Change and Candidate schema migration", () => {
  it("expands an existing repository without changing Task-owned records", () => {
    const root = initializedRepo();
    const task = taskStore(root).createTask({ title: "Existing", description: "Task", now });
    const statePath = join(root, ".but-why/state.sqlite");
    const database = new DatabaseSync(statePath);
    database.exec(`
      DROP TABLE candidates;
      DROP TABLE changes;
      DELETE FROM schema_migrations WHERE name = '015_changes_and_candidates';
    `);
    database.close();

    const result = runBy(root, "init", "--task-prefix", "BY");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("status: repaired");
    expect(taskStore(root).getTaskById(publicTaskId(task.id))).toMatchObject({ id: task.id });
    expect(createChange(root)).toMatchObject({ state: "open" });
  });

  it("rejects invalid Change lifecycle rows in a newly initialized repository", () => {
    const root = initializedRepo();
    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(() =>
        database
          .prepare(`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES ('invalid-open', '/repo/.git', 'refs/heads/open', 'open',
              'completed', ?, ?, ?)
          `)
          .run(now, now, now),
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        database
          .prepare(`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES ('invalid-closed', '/repo/.git', 'refs/heads/closed', 'closed',
              NULL, ?, ?, NULL)
          `)
          .run(now, now),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      database.close();
    }
  });
});

describe("Candidate storage", () => {
  it("reuses matching identity and provenance but rejects conflicting provenance", () => {
    const root = initializedRepo();
    const change = createChange(root);
    const store = candidateStore(root);
    const capture = {
      changeId: change.id,
      selectedBaseRef: "refs/heads/main",
      resolvedTargetSha: "1111111111111111111111111111111111111111",
      comparisonBaseSha: "2222222222222222222222222222222222222222",
      headSha: "3333333333333333333333333333333333333333",
      now,
    };

    const first = store.captureCandidate(capture);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(store.captureCandidate({ ...capture, now: "2026-07-11T11:00:00.000Z" })).toEqual({
      ok: true,
      reused: true,
      candidate: first.candidate,
    });
    expect(
      store.captureCandidate({
        ...capture,
        selectedBaseRef: "refs/heads/release",
        now: "2026-07-11T12:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      code: "candidate_provenance_conflict",
      candidate: first.candidate,
    });
    expect(store.listCandidatesForChange(change.id)).toEqual([first.candidate]);
  });

  it("keeps closed Change history readable and rejects every new capture request", () => {
    const root = initializedRepo();
    const change = createChange(root);
    const store = candidateStore(root);
    const capture = {
      changeId: change.id,
      selectedBaseRef: "refs/heads/main",
      resolvedTargetSha: "1111111111111111111111111111111111111111",
      comparisonBaseSha: "2222222222222222222222222222222222222222",
      headSha: "3333333333333333333333333333333333333333",
      now,
    };
    const candidate = store.captureCandidate(capture);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(
      changeStore(root).closeChange({
        changeId: change.id,
        reason: "completed",
        now: "2026-07-11T11:00:00.000Z",
      }).ok,
    ).toBe(true);

    expect(store.captureCandidate(capture)).toEqual({ ok: false, code: "change_closed" });
    expect(
      store.captureCandidate({
        ...capture,
        headSha: "4444444444444444444444444444444444444444",
      }),
    ).toEqual({ ok: false, code: "change_closed" });
    expect(store.getCandidateById(candidate.candidate.id)).toEqual(candidate.candidate);
  });

  it("captures and reads exact immutable code and base provenance", () => {
    const root = initializedRepo();
    const change = createChange(root);
    const store = candidateStore(root);

    const result = store.captureCandidate({
      changeId: change.id,
      selectedBaseRef: "refs/heads/main",
      resolvedTargetSha: "1111111111111111111111111111111111111111",
      comparisonBaseSha: "2222222222222222222222222222222222222222",
      headSha: "3333333333333333333333333333333333333333",
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(false);
    expect(result.candidate).toEqual({
      id: expect.any(String),
      changeId: change.id,
      selectedBaseRef: "refs/heads/main",
      resolvedTargetSha: "1111111111111111111111111111111111111111",
      comparisonBaseSha: "2222222222222222222222222222222222222222",
      headSha: "3333333333333333333333333333333333333333",
      createdAt: now,
    });
    expect(store.getCandidateById(result.candidate.id)).toEqual(result.candidate);
    expect(store.listCandidatesForChange(change.id)).toEqual([result.candidate]);
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
  return root;
};

const sqliteInput = (root: string) => ({
  statePath: join(root, ".but-why/state.sqlite"),
  migrationTimestamp: () => now,
});

const changeStore = (root: string) => openSqliteChangeStore(sqliteInput(root));

const taskStore = (root: string) => openSqliteTaskStore({ ...sqliteInput(root), taskPrefix: "BY" });

const candidateStore = (root: string) => openSqliteCandidateStore(sqliteInput(root));

const createChange = (root: string) => {
  const result = changeStore(root).createChange({
    repositoryCommonDirectory: "/repos/example/.git",
    branchRef: "refs/heads/feature",
    now,
  });
  if (!result.ok) throw new Error("Could not create test Change");
  return result.change;
};
