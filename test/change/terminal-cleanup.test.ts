import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  type CancellationDependencies,
  openCancellationUseCases,
} from "../../src/change/cancelChange.js";
import type { ChangeCleanup, ChangeRecord } from "../../src/change/change.js";
import { openTerminalCleanup } from "../../src/change/cleanupTerminalChange.js";
import type { GitHubPullRequest } from "../../src/change/ownedPullRequestGateway.js";
import type { TaskRecord } from "../../src/task/task.js";
import { type PublicTaskId, publicTaskId } from "../../src/task/taskId.js";

const now = "2026-07-24T10:00:00.000Z";
const target = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
} as const;

describe("Change-owned terminal cleanup operation", () => {
  it.effect("records complete cleanup and delegates lifecycle owners for the exact Change", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(
          events,
          changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup }),
        ),
        cleanup: (input) => {
          events.push(`cleanup:${input.remoteChangeBranch === undefined ? "none" : "remote"}`);
          return { state: "complete", blockingReason: null };
        },
        artifactLifecycle: {
          removeContent: (changeId) => {
            events.push(`artifact:${changeId}`);
            return Effect.succeed({ ok: true as const });
          },
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({
        ok: true,
        change: expect.objectContaining({
          id: "change-1",
          cleanup: { state: "complete", blockingReason: null },
        }),
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(events).toEqual([
        "cleanup:remote",
        "artifact:change-1",
        "record-cleanup",
        "remove-reviewer-sessions:change-1",
      ]);
    }),
  );

  it.effect("indexes Reviewer Transcripts before delegating resource cleanup", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(
          events,
          changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup }),
        ),
        cleanup: (input) => {
          events.push(`cleanup:${input.remoteChangeBranch === undefined ? "none" : "remote"}`);
          return { state: "complete", blockingReason: null };
        },
        indexTranscripts: (input) => {
          events.push(`index:${input.changeId}:${input.reviewerSessionPath}`);
          return Effect.succeed({ ok: true as const });
        },
        reviewerSessionPathFor: (changeId) => `/storage/${changeId}`,
        artifactLifecycle: {
          removeContent: (changeId) => {
            events.push(`artifact:${changeId}`);
            return Effect.succeed({ ok: true as const });
          },
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({
        ok: true,
        change: expect.objectContaining({
          cleanup: { state: "complete", blockingReason: null },
        }),
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(events).toEqual([
        "index:change-1:/storage/change-1",
        "cleanup:remote",
        "artifact:change-1",
        "record-cleanup",
        "remove-reviewer-sessions:change-1",
      ]);
    }),
  );

  it.effect("keeps cleanup pending without resource cleanup when transcript indexing fails", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(
          events,
          changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup }),
          { state: "pending", blockingReason: "transcript_index_failed" },
        ),
        cleanup: () => {
          events.push("cleanup");
          return { state: "complete", blockingReason: null };
        },
        indexTranscripts: () =>
          Effect.succeed({
            ok: false as const,
            reason: "unidentified_reviewer_session:acceptance/review_unknown.jsonl",
          }),
        reviewerSessionPathFor: (changeId) => `/storage/${changeId}`,
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({
        ok: true,
        change: expect.objectContaining({
          cleanup: {
            state: "pending",
            blockingReason: "transcript_index_failed",
          },
        }),
        cleanup: { state: "pending", blockingReason: "transcript_index_failed" },
      });
      expect(events).toEqual(["record-cleanup"]);
    }),
  );

  it.effect("retries transcript indexing and completes cleanup after the failure clears", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      let attempts = 0;
      let cleanupRecorded = 0;
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: {
          recordCleanup: () => {
            events.push("record-cleanup");
            cleanupRecorded += 1;
            return Effect.succeed({
              ok: true as const,
              changed: true,
              change: {
                ...change,
                cleanup:
                  cleanupRecorded === 1
                    ? { state: "pending" as const, blockingReason: "transcript_index_failed" }
                    : { state: "complete" as const, blockingReason: null },
              },
            });
          },
          removeReviewerSessions: (changeId) => {
            events.push(`remove-reviewer-sessions:${changeId}`);
            return Effect.void;
          },
        },
        cleanup: () => {
          events.push("cleanup");
          return { state: "complete", blockingReason: null };
        },
        indexTranscripts: () => {
          attempts += 1;
          events.push(`index:${attempts}`);
          return Effect.succeed(
            attempts === 1 ? { ok: false as const, reason: "temporary" } : { ok: true as const },
          );
        },
        reviewerSessionPathFor: (changeId) => `/storage/${changeId}`,
      });

      const first = yield* cleanup(change, now);
      expect(first).toMatchObject({
        cleanup: { state: "pending", blockingReason: "transcript_index_failed" },
      });

      const retry = yield* cleanup(change, now);
      expect(retry).toMatchObject({
        ok: true,
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(events).toEqual([
        "index:1",
        "record-cleanup",
        "index:2",
        "cleanup",
        "record-cleanup",
        "remove-reviewer-sessions:change-1",
      ]);
    }),
  );

  it.effect("delegates cleanup without a Remote Change Branch for an unpublished Change", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = {
        ...changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup }),
        publication: null,
      };
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(events, change),
        cleanup: (input) => {
          events.push(`cleanup:${input.remoteChangeBranch === undefined ? "none" : "remote"}`);
          return { state: "complete", blockingReason: null };
        },
      });

      const result = yield* cleanup(change, now);

      expect(result.ok).toBe(true);
      expect(events[0]).toBe("cleanup:none");
    }),
  );

  it.effect("delegates the exact Remote Change Branch for a completed published Change", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "completed", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(events, change),
        cleanup: (input) => {
          events.push(
            `cleanup:${input.remoteChangeBranch?.owner}/${input.remoteChangeBranch?.repo}:${input.remoteChangeBranch?.expectedHeadSha}`,
          );
          return { state: "complete", blockingReason: null };
        },
      });

      yield* cleanup(change, now);

      expect(events[0]).toBe("cleanup:acme/widgets:head");
      expect(events).toContain("remove-reviewer-sessions:change-1");
    }),
  );

  it.effect("keeps cleanup pending without delegating lifecycle owners", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({
        closeReason: "cancelled",
        cleanup: pendingCleanup,
      });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(events, change, {
          state: "pending",
          blockingReason: "worktree_has_uncommitted_changes",
        }),
        cleanup: () => {
          events.push("cleanup:remote");
          return { state: "pending", blockingReason: "worktree_has_uncommitted_changes" };
        },
        artifactLifecycle: {
          removeContent: (changeId) => {
            events.push(`artifact:${changeId}`);
            return Effect.succeed({ ok: true as const });
          },
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({
        ok: true,
        change: expect.objectContaining({
          cleanup: {
            state: "pending",
            blockingReason: "worktree_has_uncommitted_changes",
          },
        }),
        cleanup: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
      });
      expect(events).toEqual(["cleanup:remote", "record-cleanup"]);
    }),
  );

  it.effect("keeps cleanup pending when Artifact Content removal fails", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: echoPersistence(events, change),
        cleanup: (input) => {
          events.push(`cleanup:${input.remoteChangeBranch === undefined ? "none" : "remote"}`);
          return { state: "complete", blockingReason: null };
        },
        artifactLifecycle: {
          removeContent: (changeId) => {
            events.push(`artifact-failed:${changeId}`);
            return Effect.succeed({ ok: false as const });
          },
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({
        ok: true,
        change: expect.objectContaining({
          cleanup: {
            state: "pending",
            blockingReason: "artifact_content_removal_failed",
          },
        }),
        cleanup: {
          state: "pending",
          blockingReason: "artifact_content_removal_failed",
        },
      });
      expect(events).toEqual(["cleanup:remote", "artifact-failed:change-1", "record-cleanup"]);
    }),
  );

  it.effect("completes on retry after Artifact Content removal succeeds", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const attempts: { readonly changeId: string; readonly success: boolean }[] = [
        { changeId: "change-1", success: false },
        { changeId: "change-1", success: true },
      ];
      const cleanup = openTerminalCleanup({
        persistence: echoPersistence(events, change),
        cleanup: (input) => {
          events.push(`cleanup:${input.remoteChangeBranch === undefined ? "none" : "remote"}`);
          return { state: "complete", blockingReason: null };
        },
        artifactLifecycle: {
          removeContent: (changeId) => {
            const attempt = attempts.shift();
            events.push(`artifact:${changeId}:${attempt?.success === true ? "ok" : "failed"}`);
            return Effect.succeed(
              attempt?.success === true ? { ok: true as const } : { ok: false as const },
            );
          },
        },
      });

      const first = yield* cleanup(change, now);
      expect(first).toMatchObject({
        ok: true,
        cleanup: {
          state: "pending",
          blockingReason: "artifact_content_removal_failed",
        },
      });

      const retried = yield* cleanup(change, now);
      expect(retried).toEqual({
        ok: true,
        change: expect.objectContaining({
          cleanup: { state: "complete", blockingReason: null },
        }),
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(events).toEqual([
        "cleanup:remote",
        "artifact:change-1:failed",
        "record-cleanup",
        "cleanup:remote",
        "artifact:change-1:ok",
        "record-cleanup",
        "remove-reviewer-sessions:change-1",
      ]);
    }),
  );

  it.effect("treats already-complete cleanup as an idempotent no-op", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({
        closeReason: "cancelled",
        cleanup: { state: "complete", blockingReason: null },
      });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(events, change),
        cleanup: () => {
          events.push("cleanup");
          return { state: "complete", blockingReason: null };
        },
        artifactLifecycle: {
          removeContent: (changeId) => {
            events.push(`artifact:${changeId}`);
            return Effect.succeed({ ok: true as const });
          },
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({ ok: true, change, cleanup: change.cleanup });
      expect(events).toEqual([]);
    }),
  );

  it.effect("refuses to clean an open Change", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: null, cleanup: pendingCleanup, state: "open" });
      const cleanup = openTerminalCleanup({
        persistence: fakePersistence(events, change),
        cleanup: () => {
          events.push("cleanup");
          return { state: "complete", blockingReason: null };
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({ ok: false, code: "change_not_closed" });
      expect(events).toEqual([]);
    }),
  );

  it.effect("reports a cleanup persistence failure without undoing terminal truth", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const cleanup = openTerminalCleanup({
        persistence: {
          recordCleanup: () => {
            events.push("record-cleanup-failed");
            return Effect.succeed({ ok: false as const, code: "change_not_closed" as const });
          },
          removeReviewerSessions: (changeId) => {
            events.push(`remove-reviewer-sessions:${changeId}`);
            return Effect.void;
          },
        },
        cleanup: () => {
          events.push("cleanup");
          return { state: "complete", blockingReason: null };
        },
      });

      const result = yield* cleanup(change, now);

      expect(result).toEqual({ ok: false, code: "change_not_closed" });
      expect(events).toEqual(["cleanup", "record-cleanup-failed"]);
    }),
  );
});

describe("Repeated cancellation retries the same cleanup operation", () => {
  it.effect("retries pending cleanup when a Task Change is cancelled again", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const task = taskRecord("cancelled");
      const initialChange = changeRecord({
        taskId: publicTaskId(task.id),
        closeReason: "cancelled",
        cleanup: pendingCleanup,
      });
      const dependencies = cancellationDependencies({
        task,
        change: initialChange,
        events,
      });

      const result = yield* dependencies.cancellation.cancelTask({
        taskId: publicTaskId(task.id),
        reason: "Stop again",
        now,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "cancelled",
        changed: false,
        cleanup: { state: "complete", blockingReason: null },
      });
      expect(events).toEqual([
        "read-task",
        "read-change",
        "cleanup",
        "record-cleanup",
        "remove-reviewer-sessions:change-1",
        "read-task",
      ]);
    }),
  );

  it.effect("retries pending cleanup when a taskless Change is cancelled again", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const dependencies = cancellationDependencies({
        task: taskRecord("cancelled"),
        change,
        events,
      });

      const result = yield* dependencies.cancellation.cancelChange({
        changeId: change.id,
        reason: "Stop",
        now,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "cancelled",
        changed: false,
        change: { cleanup: { state: "complete", blockingReason: null } },
      });
      expect(events).toEqual(["cleanup", "record-cleanup", "remove-reviewer-sessions:change-1"]);
    }),
  );

  it.effect("keeps pending cleanup retryable when the cleanup record fails", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = changeRecord({ closeReason: "cancelled", cleanup: pendingCleanup });
      const dependencies = cancellationDependencies({
        task: taskRecord("cancelled"),
        change,
        recordCleanupResult: { ok: false, code: "change_not_found" },
        events,
      });

      const result = yield* dependencies.cancellation.cancelChange({
        changeId: change.id,
        reason: "Stop",
        now,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "cancelled",
        changed: false,
        change: { state: "closed", cleanup: pendingCleanup },
      });
      expect(result).not.toHaveProperty("cleanup");
      expect(events).toEqual(["cleanup", "record-cleanup"]);
    }),
  );
});

const pendingCleanup: ChangeCleanup = { state: "pending", blockingReason: null };

const changeRecord = (input: {
  readonly taskId?: PublicTaskId | null;
  readonly closeReason: "completed" | "cancelled" | null;
  readonly cleanup: ChangeCleanup;
  readonly state?: "open" | "closed";
}): ChangeRecord => ({
  id: "change-1",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/change-1",
  baseRef: "refs/heads/main",
  baseRemoteUrl: "https://github.com/acme/repo.git",
  taskId: input.taskId ?? null,
  startingCommit: "base",
  worktreePath: null,
  acceptanceContext: null,
  prepare: null,
  prepareFailure: null,
  publication: {
    candidateId: "candidate-1",
    validationRunId: "run-1",
    target,
    headBranch: "change-1",
    expectedHeadSha: "head",
    pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
  },
  cleanup: input.cleanup,
  state: input.state ?? "closed",
  closeReason: input.closeReason,
  cancelReason: input.closeReason === "cancelled" ? "Stop" : null,
  createdAt: now,
  updatedAt: now,
  closedAt: input.closeReason === null ? null : now,
});

const fakePersistence = (
  events: string[],
  recordedChange: ChangeRecord,
  cleanupResult: ChangeCleanup = { state: "complete", blockingReason: null },
) => ({
  recordCleanup: () => {
    events.push("record-cleanup");
    return Effect.succeed({
      ok: true as const,
      changed: true,
      change: { ...recordedChange, cleanup: cleanupResult },
    });
  },
  removeReviewerSessions: (changeId: string) => {
    events.push(`remove-reviewer-sessions:${changeId}`);
    return Effect.void;
  },
});

const echoPersistence = (events: string[], change: ChangeRecord) => ({
  recordCleanup: (input: { readonly changeId: string; readonly cleanup: ChangeCleanup }) => {
    events.push("record-cleanup");
    return Effect.succeed({
      ok: true as const,
      changed: true,
      change: { ...change, cleanup: input.cleanup },
    });
  },
  removeReviewerSessions: (changeId: string) => {
    events.push(`remove-reviewer-sessions:${changeId}`);
    return Effect.void;
  },
});

const taskRecord = (state: TaskRecord["state"]): TaskRecord => ({
  id: publicTaskId("BY-1"),
  title: "Cancel me",
  description: "Description",
  state,
  createdAt: now,
  updatedAt: now,
  startable: false,
  blockedBy: [],
  commentCount: 0,
  cancelReason: state === "cancelled" ? "Stop" : null,
  prerequisites: [],
  dependents: [],
});

const pullRequest = (state: "open" | "closed", merged: boolean): GitHubPullRequest => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  repository: { owner: target.owner, repo: target.repo },
  state,
  merged,
  baseBranch: target.baseBranch,
  headBranch: "change-1",
  headSha: "head",
});

const cancellationDependencies = (input: {
  readonly task: TaskRecord;
  readonly change: ChangeRecord;
  readonly recordCleanupResult?:
    | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
    | { readonly ok: false; readonly code: "change_not_found" | "change_not_closed" };
  readonly events: string[];
}): CancellationDependencies & {
  readonly cancellation: ReturnType<typeof openCancellationUseCases>;
} => {
  const changes = {
    getChangeById: () => Effect.succeed(input.change),
    getChangeByTaskId: () => {
      input.events.push("read-change");
      return Effect.succeed(input.change);
    },
    completeMergedChange: () =>
      Effect.succeed({
        ok: true as const,
        changed: true,
        change: { ...input.change, state: "closed" as const, closeReason: "completed" as const },
      }),
    cancelChange: () => Effect.succeed({ ok: true as const, changed: true, change: input.change }),
    recordCleanup: () => {
      input.events.push("record-cleanup");
      if (input.recordCleanupResult !== undefined && !input.recordCleanupResult.ok) {
        return Effect.succeed(input.recordCleanupResult);
      }
      return Effect.succeed({
        ok: true as const,
        changed: true,
        change: {
          ...input.change,
          cleanup: { state: "complete" as const, blockingReason: null },
        },
      });
    },
    removeReviewerSessions: (changeId: string) => {
      input.events.push(`remove-reviewer-sessions:${changeId}`);
      return Effect.void;
    },
  };
  const dependencies: CancellationDependencies = {
    resolveTaskId: (taskId) => ({ ok: true, taskId }),
    tasks: {
      getTaskById: () => {
        input.events.push("read-task");
        return Effect.succeed(input.task);
      },
      cancelTask: () => Effect.succeed({ ok: true as const, changed: true, task: input.task }),
    },
    changes,
    github: {
      getPullRequest: () => pullRequest("closed", false),
      closePullRequest: () => ({ ok: true, pullRequest: pullRequest("closed", false) }),
    },
    cleanupTerminal: openTerminalCleanup({
      persistence: changes,
      cleanup: () => {
        input.events.push("cleanup");
        return { state: "complete", blockingReason: null };
      },
    }),
  };
  return { ...dependencies, cancellation: openCancellationUseCases(dependencies) };
};
