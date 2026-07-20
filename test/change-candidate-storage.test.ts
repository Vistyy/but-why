import { expect, it } from "@effect/vitest";
import { describe } from "vitest";
import type { StateDatabase } from "../src/init/stateDatabase.js";
import { withStateDatabase } from "../src/sqlite/connection.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { createSqliteState } from "./support/sqliteState.js";

const now = "2026-07-11T10:00:00.000Z";

describe("Change storage", () => {
  it("creates and reads an open Change with durable repository identity", () => {
    const store = changeStore(createSqliteState());

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
      cleanup: { state: "complete", blockingReason: null },
      state: "open",
      closeReason: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    });
    expect(store.getChangeById(result.change.id)).toEqual(result.change);
  });

  it("closes a Change permanently while preserving its branch binding", () => {
    const store = changeStore(createSqliteState());
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
        cleanup: { state: "pending", blockingReason: null },
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

  it("lists only open Changes with recorded PRs and closed Changes with pending cleanup", () => {
    const store = changeStore(createSqliteState());
    const ignored = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/ignored",
      now,
    });
    const published = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/published",
      now,
    });
    const closed = store.createChange({
      repositoryCommonDirectory: "/repos/example/.git",
      branchRef: "refs/heads/closed",
      now,
    });
    expect(ignored.ok && published.ok && closed.ok).toBe(true);
    if (!published.ok || !closed.ok) return;
    const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };
    expect(
      store.beginPublication({
        changeId: published.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch: "published",
        expectedHeadSha: "expected-head",
        now,
      }).ok,
    ).toBe(true);
    expect(
      store.recordPublishedPullRequest({
        changeId: published.change.id,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch: "published",
        expectedHeadSha: "expected-head",
        pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        now,
      }).ok,
    ).toBe(true);
    expect(store.closeChange({ changeId: closed.change.id, reason: "cancelled", now }).ok).toBe(
      true,
    );

    expect(store.listChangesForReconciliation("/repos/example/.git")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: published.change.id, state: "open" }),
        expect.objectContaining({
          id: closed.change.id,
          state: "closed",
          cleanup: { state: "pending", blockingReason: null },
        }),
      ]),
    );
    expect(store.listChangesForReconciliation("/repos/example/.git")).toHaveLength(2);
  });

  it("enforces permanent repository branch bindings", () => {
    const store = changeStore(createSqliteState());

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

describe("Change schema constraints", () => {
  it("rejects invalid Change lifecycle rows in a newly initialized database", () => {
    withStateDatabase(createSqliteState(), (database) => {
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
    const state = createSqliteState();
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
    const state = createSqliteState();
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
    const state = createSqliteState();
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

const changeStore = (state: StateDatabase) => openSqliteChangeStore(state);

const candidateStore = (state: StateDatabase) => openSqliteCandidateStore(state);

const createChange = (state: StateDatabase) => {
  const result = changeStore(state).createChange({
    repositoryCommonDirectory: "/repos/example/.git",
    branchRef: "refs/heads/feature",
    now,
  });
  if (!result.ok) throw new Error("Could not create test Change");
  return result.change;
};
