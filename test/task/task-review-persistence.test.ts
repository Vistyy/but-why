import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  cleanupExactDisposableWorkspace,
  createDetachedDisposableWorktree,
  prepareDisposableWorkspaceParent,
} from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteAgentSessionPersistence } from "../../src/sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { verifyRecordedTaskReviewBase } from "../../src/task/review/adapters/taskReviewGit.js";
import { abandonTaskReview } from "../../src/task/review/taskReviewUseCases.js";
import { expectedTaskReviewWorkspacePath } from "../../src/task/review/taskReviewWorkspace.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { createGitRepo } from "../support/by-cli.js";
import { withTemporaryRepositoryState, withTestRepository } from "../support/repository.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";

const now = "2026-08-11T12:00:00.000Z";
const later = "2026-08-11T12:05:00.000Z";
const policy = {
  profile: {
    agentProfile: "review",
    scope: "global" as const,
    profile: { agentRuntime: "pi" as const },
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

it.scoped("allocates ordered numeric Task Review IDs and enforces one Active Review", () =>
  withTemporaryRepositoryState(({ commonDirectory }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence(commonDirectory);
      yield* tasks.createTask({ title: "Dependency", description: "Observed dependency", now });
      yield* tasks.createTask({
        title: "Proposal",
        description: "Exact description",
        dependsOn: [publicTaskId("BY-1")],
        now,
      });

      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      expect(admitted).toMatchObject({
        ok: true,
        review: { id: 1, state: "running", outcome: null },
        proposal: {
          title: "Proposal",
          description: "Exact description",
          dependencyIds: ["BY-1"],
        },
        dependencyEvidence: [
          { id: "BY-1", title: "Dependency", description: "Observed dependency", state: "new" },
        ],
      });

      expect(
        yield* reviews.admit({
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          now,
        }),
      ).toEqual({ ok: false, code: "active_task_review", reviewId: 1 });
    }),
  ),
);

it.effect("abandons a Task Review through workspace and Agent Session recovery", () => {
  const root = createGitRepo();
  runTestProcessOrThrow("git", ["config", "user.name", "But Why Test"], { cwd: root });
  runTestProcessOrThrow("git", ["config", "user.email", "but-why@example.test"], { cwd: root });
  runTestProcessOrThrow("git", ["branch", "-M", "main"], { cwd: root });
  writeFileSync(`${root}/README.md`, "Task Review recovery fixture.\n");
  runTestProcessOrThrow("git", ["add", "README.md"], { cwd: root });
  runTestProcessOrThrow("git", ["commit", "-m", "Create recovery fixture"], { cwd: root });
  const baseCommit = runTestProcessOrThrow("git", ["rev-parse", "HEAD"], { cwd: root });
  mkdirSync(`${root}/.git/but-why`);

  return withTestRepository(
    root,
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence(root);
      const agents = yield* openSqliteAgentSessionPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit,
        now,
      });
      if (!admitted.ok) throw new Error(`Could not admit Review: ${admitted.code}`);

      const workspacePath = expectedTaskReviewWorkspacePath(root, admitted.review.id);
      expect(yield* prepareDisposableWorkspaceParent(root)).toEqual({ ok: true });
      expect(yield* createDetachedDisposableWorktree(root, workspacePath, baseCommit)).toEqual({
        ok: true,
      });
      expect(existsSync(workspacePath)).toBe(true);

      const configuration = {
        harness: "pi" as const,
        model: "test-model",
        thinking: "off" as const,
      };
      const started = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: admitted.review.id,
          configuration,
          configurationSnapshot: policy,
        }),
      });
      if (!started.ok) throw new Error(`Could not start Invocation: ${started.code}`);

      const abandoned = yield* abandonTaskReview(
        {
          mainCheckoutRoot: root,
          persistence: reviews,
          verifyReviewBase: verifyRecordedTaskReviewBase,
          cleanupWorkspace: cleanupExactDisposableWorkspace,
        },
        admitted.review.id,
        "Reviewer process stopped",
        later,
      );

      expect(abandoned).toMatchObject({
        ok: true,
        outcome: "tooling_failed",
        review: {
          outcome: "tooling_failed",
          workspaceCleanup: "removed",
          toolingFailure: {
            operation: "task_review_abandoned",
            message: "Reviewer process stopped",
          },
        },
        task: { id: "BY-1", state: "new" },
      });
      expect(existsSync(workspacePath)).toBe(false);
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "new" });

      const history = yield* agents.readInvocationHistory(started.dispatch.agentSessionId);
      expect(history).toMatchObject([
        {
          settlementKind: "return_unknown",
          settledAt: later,
          usage: null,
          continuation: { unusableReason: expect.stringContaining("Reviewer process stopped") },
        },
      ]);
      const replacement = yield* agents.beginInvocation({
        agentSessionId: started.dispatch.agentSessionId,
        configuration,
        createdAt: later,
        linkInvocation: () => Effect.void,
      });
      expect(replacement).toMatchObject({ ok: true, dispatch: { resumed: false } });
    }),
  );
});

it.scoped("orders immutable Task Review history by its SQLite ID", () =>
  withTemporaryRepositoryState(({ commonDirectory }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence(commonDirectory);
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });

      const first = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!first.ok) throw new Error(`Task Review admission failed: ${first.code}`);
      yield* reviews.recordCleanup(first.review.id, "removed", now);
      const blocked = yield* reviews.complete({
        reviewId: first.review.id,
        findings: [
          {
            title: "Clarify scope",
            description: "The proposal is incomplete.",
            evidence: "Missing supported outcome.",
            files: [],
          },
        ],
        now,
      });
      expect(blocked).toMatchObject({ ok: true, outcome: "blocked" });

      const second = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        now,
      });
      if (!second.ok) throw new Error(`Task Review admission failed: ${second.code}`);
      expect(second.review.id).toBe(2);
      yield* reviews.recordCleanup(second.review.id, "removed", now);
      const passed = yield* reviews.complete({ reviewId: second.review.id, findings: [], now });
      expect(passed).toMatchObject({ ok: true, outcome: "passed" });

      expect((yield* reviews.listForTask(publicTaskId("BY-1"))).map((review) => review.id)).toEqual(
        [1, 2],
      );
      expect(yield* reviews.getLatestForTask(publicTaskId("BY-1"))).toMatchObject({
        id: 2,
        outcome: "passed",
      });
    }),
  ),
);
