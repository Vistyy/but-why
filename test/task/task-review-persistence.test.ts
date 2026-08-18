import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import {
  createDetachedDisposableWorktree,
  prepareDisposableWorkspaceParent,
} from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteAgentSessionPersistence } from "../../src/sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { withTaskReviewRecoveryUseCases } from "../../src/task/composition/loadTaskReviewUseCases.js";
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
    profile: {
      agentRuntime: "pi" as const,
      runtimeConfig: { model: "test-model" },
    },
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

it.scoped("allocates ordered numeric Task Review IDs and enforces one Active Review", () =>
  withTemporaryRepositoryState(({ mainCheckoutRoot }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence(mainCheckoutRoot);
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
  mkdirSync(`${root}/.but-why`);
  writeFileSync(`${root}/.but-why/config.json`, JSON.stringify({ idPrefix: "BY" }));

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
      };
      const started = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: admitted.review.id,
          configurationSnapshot: policy,
        }),
      });
      if (!started.ok) throw new Error(`Could not start Invocation: ${started.code}`);

      const recovered = yield* withTaskReviewRecoveryUseCases({ cwd: root }, (recovery) =>
        recovery.abandon(admitted.review.id, "Reviewer process stopped", later),
      );
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) throw new Error(`Could not load recovery: ${recovered.error.code}`);
      const abandoned = recovered.value;

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

it.scoped("requires atomic Agent settlement to pass an Active Task Review", () =>
  withTemporaryRepositoryState(({ mainCheckoutRoot }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence(mainCheckoutRoot);
      const agents = yield* openSqliteAgentSessionPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(`Task Review admission failed: ${admitted.code}`);
      yield* reviews.recordCleanup(admitted.review.id, "removed", now);
      const configuration = { harness: "pi" as const, model: "test-model" };
      const invocation = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: admitted.review.id,
          configurationSnapshot: policy,
        }),
      });
      if (!invocation.ok) throw new Error(invocation.code);
      yield* agents.settleInvocation({
        invocationId: invocation.dispatch.invocation.id,
        continuationId: invocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "returned" },
      });

      expect(
        yield* reviews
          .complete({ reviewId: admitted.review.id, findings: [], now: later })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      expect(yield* reviews.getById(admitted.review.id)).toMatchObject({
        state: "running",
        outcome: null,
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "new" });
    }),
  ),
);

it.scoped("orders immutable Task Review history by its SQLite ID", () =>
  withTemporaryRepositoryState(({ mainCheckoutRoot }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence(mainCheckoutRoot);
      const agents = yield* openSqliteAgentSessionPersistence();
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
      const blockedFindings = [
        {
          title: "Clarify scope",
          description: "The proposal is incomplete.",
          evidence: "Missing supported outcome.",
          files: [],
        },
      ];
      expect(
        yield* reviews
          .complete({ reviewId: first.review.id, findings: blockedFindings, now })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      const configuration = { harness: "pi" as const, model: "test-model" };
      const blockedInvocation = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: first.review.id,
          configurationSnapshot: policy,
        }),
      });
      if (!blockedInvocation.ok) throw new Error(blockedInvocation.code);
      expect(
        yield* agents
          .settleInvocation({
            invocationId: blockedInvocation.dispatch.invocation.id,
            continuationId: blockedInvocation.dispatch.continuation.id,
            settlement: {
              settledAt: later,
              kind: "launch_failed",
              unusableReason: "The Agent did not return Findings.",
            },
            settleDomain: reviews.settleAgentReview({
              reviewId: first.review.id,
              findings: blockedFindings,
              now: later,
              complete: true,
            }),
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      yield* agents.settleInvocation({
        invocationId: blockedInvocation.dispatch.invocation.id,
        continuationId: blockedInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "returned" },
        settleDomain: reviews.settleAgentReview({
          reviewId: first.review.id,
          findings: blockedFindings,
          now: later,
          complete: true,
        }),
      });
      const blocked = yield* reviews.complete({
        reviewId: first.review.id,
        findings: blockedFindings,
        now: later,
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
      const passedInvocation = yield* agents.beginInvocation({
        agentSessionId: blockedInvocation.dispatch.agentSessionId,
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: second.review.id,
          configurationSnapshot: policy,
        }),
      });
      if (!passedInvocation.ok) throw new Error(passedInvocation.code);
      yield* agents.settleInvocation({
        invocationId: passedInvocation.dispatch.invocation.id,
        continuationId: passedInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "returned" },
        settleDomain: reviews.settleAgentReview({
          reviewId: second.review.id,
          findings: [],
          now: later,
          complete: true,
        }),
      });
      const passed = yield* reviews.complete({
        reviewId: second.review.id,
        findings: [],
        now: later,
      });
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
