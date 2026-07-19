import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import {
  prepareStateDatabaseSession,
  type StateDatabaseSession,
} from "../src/init/stateDatabase.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, runByInProcessArgs as runBy } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { createSqliteStateSession } from "./support/sqliteState.js";

const now = "2026-07-11T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("Change storage", () => {
  it("creates and reads an open Change with durable repository identity", () => {
    const store = changeStore(createSqliteStateSession());

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
      baseRef: null,
      taskId: null,
      startingCommit: null,
      worktreePath: null,
      acceptanceContext: null,
      readiness: null,
      prepare: null,
      prepareFailure: null,
      publication: null,
      state: "open",
      closeReason: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    });
    expect(store.getChangeById(result.change.id)).toEqual(result.change);
  });

  it("closes a Change permanently while preserving its branch binding", () => {
    const store = changeStore(createSqliteStateSession());
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

  it("enforces permanent repository branch bindings", () => {
    const store = changeStore(createSqliteStateSession());

    const first = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/feature",
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
  });
});

describe("Change and Candidate schema migration", () => {
  it("expands an existing repository without changing Task-owned records", () => {
    const root = initializedRepo();
    const task = taskStore(sqliteInput(root)).createTask({
      title: "Existing",
      description: "Task",
      now,
    });
    const statePath = sharedStatePath(root);
    const database = new DatabaseSync(statePath);
    database.exec(`
      DROP TABLE candidates;
      DROP TABLE changes;
      DELETE FROM schema_migrations
      WHERE name IN (
        '015_changes_and_candidates',
        '016_change_base_ref',
        '021_task_starts',
        '022_change_owned_worktrees',
        '024_change_owned_pull_requests'
      );
    `);
    database.close();

    const result = runBy(root, "init", "--task-prefix", "BY");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("status: repaired");
    expect(taskStore(sqliteInput(root)).getTaskById(publicTaskId(task.id))).toMatchObject({
      id: task.id,
    });
    expect(createChange(sqliteInput(root))).toMatchObject({ state: "open" });
  });

  it("adds optional Change bases without changing existing Change or Candidate history", () => {
    const root = initializedRepo();
    const change = createChange(sqliteInput(root));
    const candidate = candidateStore(sqliteInput(root)).captureCandidate({
      changeId: change.id,
      selectedBaseRef: "refs/heads/main",
      resolvedTargetSha: "1111111111111111111111111111111111111111",
      comparisonBaseSha: "2222222222222222222222222222222222222222",
      headSha: "3333333333333333333333333333333333333333",
      now,
    });
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const database = new DatabaseSync(sharedStatePath(root));
    database.exec(`
      ALTER TABLE changes DROP COLUMN base_ref;
      DELETE FROM schema_migrations WHERE name = '016_change_base_ref';
    `);
    database.close();

    expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
    expect(changeStore(sqliteInput(root)).getChangeById(change.id)).toMatchObject({
      id: change.id,
      baseRef: null,
    });
    expect(candidateStore(sqliteInput(root)).getCandidateById(candidate.candidate.id)).toEqual(
      candidate.candidate,
    );
  });
});

describe("Change schema constraints", () => {
  it("rejects invalid Change lifecycle rows in a newly initialized database", () => {
    createSqliteStateSession().withDatabase((database) => {
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
    });
  });
});

describe("Candidate storage", () => {
  it("reuses matching identity and provenance but rejects conflicting provenance", () => {
    const state = createSqliteStateSession();
    const change = createChange(state);
    const store = candidateStore(state);
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
    const state = createSqliteStateSession();
    const change = createChange(state);
    const store = candidateStore(state);
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
      changeStore(state).closeChange({
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
    const state = createSqliteStateSession();
    const change = createChange(state);
    const store = candidateStore(state);

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
    expect(changeStore(state).getChangeById(change.id)).toMatchObject({
      baseRef: "refs/heads/main",
    });
    expect(
      store.captureCandidate({
        changeId: change.id,
        selectedBaseRef: "refs/heads/release",
        resolvedTargetSha: "4444444444444444444444444444444444444444",
        comparisonBaseSha: "5555555555555555555555555555555555555555",
        headSha: "6666666666666666666666666666666666666666",
        now,
      }),
    ).toEqual({ ok: false, code: "change_base_ref_conflict" });
  });
});

const initializedRepo = (): string => createInitializedRepo();

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const sqliteInput = (root: string) =>
  prepareStateDatabaseSession({
    statePath: sharedStatePath(root),
    migrationTimestamp: () => now,
  });

const changeStore = (state: StateDatabaseSession) => openSqliteChangeStore(state);

const taskStore = (state: StateDatabaseSession) =>
  openSqliteTaskStore({ ...state, taskPrefix: "BY" });

const candidateStore = (state: StateDatabaseSession) => openSqliteCandidateStore(state);

const createChange = (state: StateDatabaseSession) => {
  const result = changeStore(state).createChange({
    repositoryCommonDirectory: "/repos/example/.git",
    branchRef: "refs/heads/feature",
    now,
  });
  if (!result.ok) throw new Error("Could not create test Change");
  return result.change;
};
