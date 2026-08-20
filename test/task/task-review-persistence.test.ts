import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { openSqliteAgentSessionPersistence } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import {
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
} from "../../src/contracts/repositoryStorageError.js";
import {
  createDetachedDisposableWorktree,
  prepareDisposableWorkspaceParent,
} from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { withTaskReviewRecoveryUseCases } from "../../src/task/composition/loadTaskReviewUseCases.js";
import { settleTaskReviewEvidence } from "../../src/task/review/taskReviewEvidenceSettlement.js";
import { expectedTaskReviewWorkspacePath } from "../../src/task/review/taskReviewWorkspace.js";
import { internalTaskId, publicTaskId } from "../../src/task/taskId.js";
import { openSqliteTaskChangeReviewAdmissionPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeReviewAdmissionPersistence.js";
import { createGitRepo, runByInProcessEffect } from "../support/by-cli.js";
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
    globalConfigDirectory: "/global/config",
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

it.effect("persists dispatch identity through Task Review inspection and CLI output", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    expect(initialized.status, initialized.stdout).toBe(0);
    const loaded = openRepositoryRuntime(root);
    if (!loaded.ok) throw new Error(`Could not open repository: ${loaded.error.code}`);
    yield* loaded.runtime.provide(
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence();
        const reviews = yield* openSqliteTaskReviewPersistence();
        const taskId = publicTaskId("BY-1");
        yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
        const admitted = yield* reviews.admit({
          taskId,
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          now,
        });
        if (!admitted.ok) throw new Error(`Task Review admission failed: ${admitted.code}`);
        yield* reviews.recordCleanup(admitted.review.id, "removed", now);
        const failure = {
          operation: "dispatch_agent_invocation" as const,
          message: "Agent Invocation dispatch was blocked.",
          blockingInvocationId: 29,
        };
        yield* reviews.recordActiveFailure(admitted.review.id, failure, now);
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "change Task Review proposal during dispatch failure",
          (sql) => sql`
            UPDATE tasks SET title = 'Changed after admission'
            WHERE id = ${internalTaskId(taskId, repository.idPrefix)}
          `,
        );
        const completed = yield* reviews.complete({
          reviewId: admitted.review.id,
          findings: [],
          toolingFailure: failure,
          now,
        });
        expect(completed).toMatchObject({
          ok: true,
          outcome: "tooling_failed",
          review: { toolingFailure: failure },
        });
      }),
    );

    const reviewShown = yield* runByInProcessEffect(root, ["task", "review", "show", "1"]);
    expect(reviewShown.status, reviewShown.stdout).toBe(0);
    expect(JSON.parse(reviewShown.stdout)).toMatchObject({
      review: {
        toolingFailure: {
          operation: "dispatch_agent_invocation",
          blockingInvocationId: 29,
        },
        agentSession: { invocations: [] },
      },
    });
    const taskShown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(taskShown.status, taskShown.stdout).toBe(0);
    expect(JSON.parse(taskShown.stdout)).toMatchObject({
      task: {
        review: {
          toolingFailure: {
            operation: "dispatch_agent_invocation",
            blockingInvocationId: 29,
          },
        },
      },
    });
  }),
);

it.scoped("preserves dispatch evidence when Task Review admission changes", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const taskId = publicTaskId("BY-1");
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(`Task Review admission failed: ${admitted.code}`);
      yield* reviews.recordCleanup(admitted.review.id, "removed", now);
      const failure = {
        operation: "dispatch_agent_invocation" as const,
        message: "Agent Invocation dispatch was blocked.",
        blockingInvocationId: 29,
      };
      yield* reviews.recordActiveFailure(admitted.review.id, failure, now);
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "change Task Review proposal during dispatch failure",
        (sql) => sql`
          UPDATE tasks SET title = 'Changed after admission'
          WHERE id = ${internalTaskId(taskId, repository.idPrefix)}
        `,
      );
      const completed = yield* reviews.complete({
        reviewId: admitted.review.id,
        findings: [],
        toolingFailure: failure,
        now,
      });
      expect(completed).toMatchObject({
        ok: true,
        outcome: "tooling_failed",
        review: { toolingFailure: failure },
      });
    }),
  ),
);

it.scoped("preserves dispatch evidence when Task Review cleanup fails", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const reviews = yield* openSqliteTaskReviewPersistence();
      const taskId = publicTaskId("BY-1");
      const tasks = yield* openSqliteTaskPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(`Task Review admission failed: ${admitted.code}`);
      yield* reviews.recordCleanup(admitted.review.id, "removed", now);
      const failure = {
        operation: "dispatch_agent_invocation" as const,
        message: "Agent Invocation dispatch was blocked.",
        blockingInvocationId: 29,
      };
      yield* reviews.recordActiveFailure(admitted.review.id, failure, now);
      const settlement = yield* settleTaskReviewEvidence(
        {
          repositoryRoot: "/repository",
          repositoryCommonDirectory: "/common",
          persistence: reviews,
          verifyReviewBase: () => Effect.succeed({ ok: true as const }),
          cleanupWorkspace: () =>
            Effect.succeed({ workspace: "failed" as const, errorMessage: "Cleanup failed." }),
        },
        admitted.review,
        later,
      );
      expect(settlement).toMatchObject({
        ok: false,
        review: {
          workspaceCleanup: "failed",
          cleanupBlockingReason: "Cleanup failed.",
          toolingFailure: failure,
        },
      });
      expect(yield* reviews.getById(admitted.review.id)).toMatchObject({
        state: "running",
        toolingFailure: failure,
      });
    }),
  ),
);

it.scoped("does not adopt the blocking Agent Invocation during dispatch", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const agents = yield* openSqliteAgentSessionPersistence();
      const taskId = publicTaskId("BY-1");
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(`Task Review admission failed: ${admitted.code}`);
      yield* reviews.recordCleanup(admitted.review.id, "removed", now);
      const configuration = { harness: "pi" as const, model: "test-model" };
      const first = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: () => Effect.void,
      });
      if (!first.ok) throw new Error(`Agent Invocation setup failed: ${first.code}`);
      let linkCalls = 0;
      const link = reviews.linkAgentInvocation({
        taskId,
        reviewId: admitted.review.id,
        admittedPolicy: admitted.policy,
      });
      const blocked = yield* agents.beginInvocation({
        agentSessionId: first.dispatch.agentSessionId,
        configuration,
        createdAt: later,
        linkInvocation: (sql, invocationId) =>
          Effect.sync(() => {
            linkCalls += 1;
          }).pipe(Effect.zipRight(link(sql, invocationId))),
      });
      expect(blocked).toEqual({
        ok: false,
        code: "concurrent_unsettled_invocation",
        invocationId: first.dispatch.invocation.id,
      });
      expect(linkCalls).toBe(0);
      expect(yield* agents.readInvocationHistory(first.dispatch.agentSessionId)).toHaveLength(1);
      const failure = {
        operation: "dispatch_agent_invocation" as const,
        message: "Agent Invocation dispatch was blocked.",
        blockingInvocationId: first.dispatch.invocation.id,
      };
      yield* reviews.recordActiveFailure(admitted.review.id, failure, later);
      const completed = yield* reviews.complete({
        reviewId: admitted.review.id,
        findings: [],
        toolingFailure: failure,
        now: later,
      });
      expect(completed).toMatchObject({
        ok: true,
        outcome: "tooling_failed",
        review: { toolingFailure: failure },
      });
    }),
  ),
);

it.scoped("allocates ordered numeric Task Review IDs and enforces one Active Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
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

      if (!admitted.ok) throw new Error(admitted.code);
      expect(admitted.review.agentSessionId).toBeUndefined();
      expect(admitted.review.reviewerConfiguration).toBeUndefined();

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

it.scoped("distinguishes missing completion from inactive recovery and gates retry admission", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const taskId = publicTaskId("BY-1");
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });

      expect(yield* reviews.complete({ reviewId: 999, findings: [], now })).toEqual({
        ok: false,
        code: "task_review_not_found",
      });
      expect(yield* reviews.checkAdmission(taskId)).toBeUndefined();

      const admitted = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(admitted.code);
      expect(yield* reviews.checkAdmission(taskId)).toEqual({
        ok: false,
        code: "active_task_review",
        reviewId: admitted.review.id,
      });
      expect(yield* reviews.complete({ reviewId: admitted.review.id, findings: [], now })).toEqual({
        ok: false,
        code: "task_review_not_active",
      });
    }),
  ),
);

it.scoped("keeps malformed and SQL completion failures distinct", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(admitted.code);

      yield* repository.operation(
        "inject malformed Task Review completion state",
        (sql) => sql`
          UPDATE task_reviews
          SET tooling_failure = '{"operation":"run_task_review","message":"Failed.","extra":true}'
          WHERE id = ${admitted.review.id}
        `,
      );
      expect(
        yield* reviews
          .complete({ reviewId: admitted.review.id, findings: [], now })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);

      yield* repository.operation(
        "remove Task Review storage",
        (sql) => sql`DROP TABLE task_reviews`,
      );
      expect(
        yield* reviews
          .complete({ reviewId: admitted.review.id, findings: [], now })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositorySqlOperationFailed);
    }),
  ),
);

it.scoped("derives an admitted Task Review workspace from the Git Common Directory", () =>
  withTemporaryRepositoryState((input) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const admission = yield* openSqliteTaskChangeReviewAdmissionPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });

      const admitted = yield* admission.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });

      expect(admitted).toMatchObject({
        ok: true,
        review: {
          workspacePath: expectedTaskReviewWorkspacePath(input.commonDirectory, 1),
        },
      });
    }),
  ),
);

it.scoped("rejects Task reviewer policy changes after the first Invocation", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const agents = yield* openSqliteAgentSessionPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });

      const first = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!first.ok) throw new Error(first.code);
      const failedInvocation = yield* agents.beginInvocation({
        configuration: { harness: "pi", model: "test-model" },
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: first.review.id,
          admittedPolicy: first.policy,
        }),
      });
      if (!failedInvocation.ok) throw new Error(failedInvocation.code);
      yield* agents.settleInvocation({
        invocationId: failedInvocation.dispatch.invocation.id,
        continuationId: failedInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "launch_failed" },
      });
      yield* reviews.recordCleanup(first.review.id, "removed", later);
      yield* reviews.complete({
        reviewId: first.review.id,
        findings: [],
        toolingFailure: { operation: "run_task_reviewer", message: "Reviewer launch failed." },
        now: later,
      });

      const correctedPolicy = {
        ...policy,
        guidance: { content: "Use corrected guidance.\n", source: "repo" as const },
      };
      expect(
        yield* reviews
          .admit({
            taskId: publicTaskId("BY-1"),
            policy: correctedPolicy,
            baseRef: "refs/heads/main",
            baseCommit: "b".repeat(40),
            now: later,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);

      const historical = yield* reviews.getById(first.review.id);
      expect(historical).toMatchObject({
        agentSessionId: failedInvocation.dispatch.agentSessionId,
        agentInvocations: [
          expect.objectContaining({
            continuation: expect.objectContaining({ model: "test-model" }),
          }),
        ],
      });
      expect(historical?.reviewerConfiguration).toEqual(policy);
      expect(yield* reviews.listForTask(publicTaskId("BY-1"))).toHaveLength(1);
    }),
  ),
);

it.scoped("attributes frozen Task Reviewer configuration to every matching invoked Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const agents = yield* openSqliteAgentSessionPersistence();
      const taskId = publicTaskId("BY-1");
      const configuration = { harness: "pi" as const, model: "test-model" };
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });

      const older = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!older.ok) throw new Error(older.code);
      const olderInvocation = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId,
          reviewId: older.review.id,
          admittedPolicy: older.policy,
        }),
      });
      if (!olderInvocation.ok) throw new Error(olderInvocation.code);
      yield* agents.settleInvocation({
        invocationId: olderInvocation.dispatch.invocation.id,
        continuationId: olderInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "launch_failed" },
      });
      yield* reviews.recordCleanup(older.review.id, "removed", later);
      yield* reviews.complete({
        reviewId: older.review.id,
        findings: [],
        toolingFailure: { operation: "run_task_reviewer", message: "Older review failed." },
        now: later,
      });

      const withoutInvocation = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        now: later,
      });
      if (!withoutInvocation.ok) throw new Error(withoutInvocation.code);
      yield* reviews.recordCleanup(withoutInvocation.review.id, "removed", later);
      yield* reviews.complete({
        reviewId: withoutInvocation.review.id,
        findings: [],
        toolingFailure: { operation: "run_task_reviewer", message: "No Invocation was created." },
        now: later,
      });

      const newest = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "c".repeat(40),
        now: later,
      });
      if (!newest.ok) throw new Error(newest.code);
      const newestInvocation = yield* agents.beginInvocation({
        agentSessionId: olderInvocation.dispatch.agentSessionId,
        configuration,
        createdAt: later,
        linkInvocation: reviews.linkAgentInvocation({
          taskId,
          reviewId: newest.review.id,
          admittedPolicy: newest.policy,
        }),
      });
      if (!newestInvocation.ok) throw new Error(newestInvocation.code);

      const reviewWithoutInvocation = yield* reviews.getById(withoutInvocation.review.id);
      expect(reviewWithoutInvocation).not.toHaveProperty("reviewerConfiguration");
      expect(reviewWithoutInvocation).not.toHaveProperty("agentSessionId");
      expect(reviewWithoutInvocation).not.toHaveProperty("agentInvocations");
      expect(yield* reviews.getById(older.review.id)).toMatchObject({
        reviewerConfiguration: policy,
      });
      expect(yield* reviews.getById(newest.review.id)).toMatchObject({
        reviewerConfiguration: policy,
      });
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
      const reviews = yield* openSqliteTaskReviewPersistence();
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

      const workspacePath = expectedTaskReviewWorkspacePath(`${root}/.git`, admitted.review.id);
      expect(yield* prepareDisposableWorkspaceParent(root, `${root}/.git`)).toEqual({ ok: true });
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
          admittedPolicy: admitted.policy,
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
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      const agents = yield* openSqliteAgentSessionPersistence();
      const repository = yield* RepositorySql;
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(`Task Review admission failed: ${admitted.code}`);
      expect(
        yield* reviews
          .recordActiveFailure(
            admitted.review.id,
            { operation: " ", message: "This malformed failure must not persist." },
            now,
          )
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      expect(yield* reviews.getById(admitted.review.id)).toMatchObject({ toolingFailure: null });
      yield* repository.operation(
        "inject malformed Task Review Tooling Failure",
        (sql) => sql`
          UPDATE task_reviews
          SET tooling_failure = '{"operation":"run_task_review","message":"Failed.","extra":true}'
          WHERE id = ${admitted.review.id}
        `,
      );
      expect(yield* reviews.getById(admitted.review.id).pipe(Effect.flip)).toBeInstanceOf(
        RepositoryPersistedDataInvalid,
      );
      yield* repository.operation(
        "remove malformed Task Review Tooling Failure",
        (sql) =>
          sql`UPDATE task_reviews SET tooling_failure = NULL WHERE id = ${admitted.review.id}`,
      );
      yield* reviews.recordCleanup(admitted.review.id, "removed", now);
      const configuration = { harness: "pi" as const, model: "test-model" };
      const invocation = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: reviews.linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: admitted.review.id,
          admittedPolicy: admitted.policy,
        }),
      });
      if (!invocation.ok) throw new Error(invocation.code);
      const agentSessionId = invocation.dispatch.agentSessionId;
      expect(
        yield* agents
          .settleInvocation({
            invocationId: invocation.dispatch.invocation.id,
            continuationId: invocation.dispatch.continuation.id,
            settlement: { settledAt: later, kind: "returned" },
            settleDomain: reviews.settleAgentReview({
              reviewId: admitted.review.id,
              findings: [
                {
                  title: "Invalid file path",
                  description: "The Finding must not persist.",
                  evidence: "The file path is absolute.",
                  files: ["/absolute/path.ts"],
                },
              ],
              now: later,
              complete: true,
            }),
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      expect(yield* agents.readInvocationHistory(agentSessionId)).toMatchObject([
        { settledAt: null, settlementKind: null },
      ]);
      expect(
        yield* reviews
          .complete({ reviewId: admitted.review.id, findings: [], now: later })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      expect(yield* reviews.getById(admitted.review.id)).toMatchObject({
        state: "running",
        outcome: null,
        findings: [],
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "new" });
    }),
  ),
);

it.scoped("orders immutable Task Review history by its SQLite ID", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
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
          admittedPolicy: first.policy,
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
          admittedPolicy: second.policy,
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
