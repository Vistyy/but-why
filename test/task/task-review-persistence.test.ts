import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { beginAgentInvocation } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import {
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
} from "../../src/contracts/repositoryStorageError.js";
import {
  createDetachedDisposableWorktree,
  prepareDisposableWorkspaceParent,
} from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import {
  admitTaskReview,
  openSqliteTaskReviewPersistence,
  taskReviewAdmissionRejection,
} from "../../src/task/adapters/sqlite/sqliteTaskReviewPersistence.js";
import { withTaskReviewRecoveryUseCases } from "../../src/task/composition/loadTaskReviewUseCases.js";
import { decodeTaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";
import { expectedTaskReviewWorkspacePath } from "../../src/task/review/taskReviewWorkspace.js";
import type { TaskSimplificationAdvice } from "../../src/task/review/taskSimplificationAdvice.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { openSqliteTaskChangeReviewAdmissionPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeReviewAdmissionPersistence.js";
import { createGitRepo } from "../support/by-cli.js";
import { withTemporaryRepositoryState, withTestRepository } from "../support/repository.js";
import { createTaskInSqlite, getTaskInSqlite } from "../support/taskOperations.js";
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

const simplificationAdviceConfiguration = {
  profile: policy.profile,
  builtInInstructions: "Task Simplification Advice test instructions",
};

const simplificationAdvice: TaskSimplificationAdvice =
  "No safe simplification is supported by this test advice because the requested result is already the smallest supported outcome.";

const finding = {
  title: "Intent gap",
  description: "The proposal omits a required outcome.",
  evidence: "The proposal does not state the required result.",
  files: ["docs/spec.md"],
};

it.effect("preserves the consumed Task Reviewer output contract", () =>
  Effect.gen(function* () {
    const output = yield* decodeTaskReviewerOutput({
      attempts: 1,
      output: { findings: [finding] },
    });
    expect(output).toEqual({ findings: [finding] });

    for (const [outputValue, path] of [
      [{ findings: [{ ...finding, artifactRefs: [] }] }, "findings.0.artifactRefs"],
      [{ findings: [{ ...finding, confidence: 1 }] }, "findings.0.confidence"],
      [{ findings: [], summary: "done" }, "summary"],
      [{ findings: [{ ...finding, evidence: undefined }] }, "findings.0.evidence"],
    ] as const) {
      const error = yield* Effect.flip(
        decodeTaskReviewerOutput({ attempts: 2, output: outputValue }),
      );
      expect(error).toMatchObject({
        _tag: "TaskReviewerOutputContractFailed",
        operationName: "decode_task_reviewer_output",
        reviewer: "task",
        attempts: 2,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ path: path.split(".").map(pathPart) }),
        ]),
      });
    }
  }),
);

const pathPart = (value: string): string | number =>
  /^\d+$/u.test(value) ? Number.parseInt(value, 10) : value;

it.scoped("allocates ordered numeric Task Review IDs and enforces one Active Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* createTaskInSqlite({ title: "Dependency", description: "Observed dependency", now });
      yield* createTaskInSqlite({
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
      const reviews = yield* openSqliteTaskReviewPersistence();
      const taskId = publicTaskId("BY-1");
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });

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
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });
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
      const admission = yield* openSqliteTaskChangeReviewAdmissionPersistence({
        checkAdmission: taskReviewAdmissionRejection,
        admit: admitTaskReview,
      });
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });

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

it.scoped("decodes persisted Task Simplification Advice Invocation evidence before use", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        simplificationAdvice: { configuration: simplificationAdviceConfiguration },
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!admitted.ok) throw new Error(admitted.code);

      const invocation = yield* reviews.agentSessionJournal.beginInvocation({
        configuration: { harness: "pi", model: "test-model" },
        createdAt: now,
        entry: {
          kind: "simplification_advice_dispatch",
          reviewId: admitted.review.id,
        },
      });
      if (!invocation.ok) throw new Error(invocation.code);
      yield* reviews.agentSessionJournal.settleInvocation({
        invocationId: invocation.dispatch.invocation.id,
        continuationId: invocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "returned" },
        entry: {
          kind: "simplification_advice_settlement",
          reviewId: admitted.review.id,
          complete: true,
          advice: simplificationAdvice,
        },
      });

      const decoded = yield* reviews.getById(admitted.review.id);
      expect(decoded).toMatchObject({
        simplificationAdviceAttempt: {
          state: "completed",
          agentInvocations: [{ id: invocation.dispatch.invocation.id }],
        },
      });

      yield* repository.operation(
        "inject invalid Task Review settlement kind",
        (sql) => sql`
          UPDATE agent_invocations SET settlement_kind = 'unsupported'
          WHERE id = ${invocation.dispatch.invocation.id}
        `,
      );
      expect(yield* reviews.getById(admitted.review.id).pipe(Effect.flip)).toBeInstanceOf(
        RepositoryPersistedDataInvalid,
      );

      yield* repository.operation(
        "restore Task Review settlement kind",
        (sql) => sql`
          UPDATE agent_invocations SET settlement_kind = 'returned'
          WHERE id = ${invocation.dispatch.invocation.id}
        `,
      );
      yield* repository.operation(
        "inject invalid Task Review thinking level",
        (sql) => sql`
          UPDATE agent_continuations SET thinking = 'unsupported'
          WHERE id = ${invocation.dispatch.continuation.id}
        `,
      );
      expect(yield* reviews.getById(admitted.review.id).pipe(Effect.flip)).toBeInstanceOf(
        RepositoryPersistedDataInvalid,
      );

      yield* repository.operation(
        "restore Task Review thinking level",
        (sql) => sql`
          UPDATE agent_continuations SET thinking = NULL
          WHERE id = ${invocation.dispatch.continuation.id}
        `,
      );
      yield* repository.operation("allow malformed Task Review evidence", (sql) =>
        sql.unsafe("PRAGMA ignore_check_constraints = ON").pipe(Effect.asVoid),
      );
      yield* repository.operation(
        "remove completed advice Invocation evidence",
        (sql) => sql`
          UPDATE task_review_simplification_advice
          SET agent_invocation_id = NULL
          WHERE task_review_id = ${admitted.review.id}
        `,
      );
      expect(yield* reviews.getById(admitted.review.id).pipe(Effect.flip)).toBeInstanceOf(
        RepositoryPersistedDataInvalid,
      );
    }),
  ),
);

it.scoped("rejects Task reviewer policy changes after the first Invocation", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });

      const first = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!first.ok) throw new Error(first.code);
      const failedInvocation = yield* reviews.agentSessionJournal.beginInvocation({
        configuration: { harness: "pi", model: "test-model" },
        createdAt: now,
        entry: {
          kind: "task_review_dispatch",
          taskId: publicTaskId("BY-1"),
          reviewId: first.review.id,
          admittedPolicy: first.policy,
        },
      });
      if (!failedInvocation.ok) throw new Error(failedInvocation.code);
      yield* reviews.agentSessionJournal.settleInvocation({
        invocationId: failedInvocation.dispatch.invocation.id,
        continuationId: failedInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "launch_failed" },
        entry: undefined,
        retry: true,
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
      const reviews = yield* openSqliteTaskReviewPersistence();
      const taskId = publicTaskId("BY-1");
      const configuration = { harness: "pi" as const, model: "test-model" };
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });

      const older = yield* reviews.admit({
        taskId,
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!older.ok) throw new Error(older.code);
      const olderInvocation = yield* reviews.agentSessionJournal.beginInvocation({
        configuration,
        createdAt: now,
        entry: {
          kind: "task_review_dispatch",
          taskId,
          reviewId: older.review.id,
          admittedPolicy: older.policy,
        },
      });
      if (!olderInvocation.ok) throw new Error(olderInvocation.code);
      yield* reviews.agentSessionJournal.settleInvocation({
        invocationId: olderInvocation.dispatch.invocation.id,
        continuationId: olderInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "launch_failed" },
        entry: undefined,
        retry: true,
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
      const newestInvocation = yield* reviews.agentSessionJournal.beginInvocation({
        agentSessionId: olderInvocation.dispatch.agentSessionId,
        configuration,
        createdAt: later,
        entry: {
          kind: "task_review_dispatch",
          taskId,
          reviewId: newest.review.id,
          admittedPolicy: newest.policy,
        },
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
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });
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
      const started = yield* reviews.agentSessionJournal.beginInvocation({
        configuration,
        createdAt: now,
        entry: {
          kind: "task_review_dispatch",
          taskId: publicTaskId("BY-1"),
          reviewId: admitted.review.id,
          admittedPolicy: admitted.policy,
        },
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
      expect(yield* getTaskInSqlite(publicTaskId("BY-1"))).toMatchObject({ state: "new" });

      const history = (yield* reviews.getById(admitted.review.id))?.agentInvocations ?? [];
      expect(history).toMatchObject([
        {
          settlementKind: "return_unknown",
          settledAt: later,
          usage: null,
          continuation: { unusableReason: expect.stringContaining("Reviewer process stopped") },
        },
      ]);
      const repository = yield* RepositorySql;
      const replacement = yield* repository.transactionImmediate(
        "dispatch replacement Agent Invocation",
        (sql) =>
          beginAgentInvocation(sql, {
            agentSessionId: started.dispatch.agentSessionId,
            configuration,
            createdAt: later,
          }),
      );
      expect(replacement).toMatchObject({ ok: true, dispatch: { resumed: false } });
    }),
  );
});

it.scoped("requires atomic Agent settlement to pass an Active Task Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });
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
      const invocation = yield* reviews.agentSessionJournal.beginInvocation({
        configuration,
        createdAt: now,
        entry: {
          kind: "task_review_dispatch",
          taskId: publicTaskId("BY-1"),
          reviewId: admitted.review.id,
          admittedPolicy: admitted.policy,
        },
      });
      if (!invocation.ok) throw new Error(invocation.code);
      expect(
        yield* reviews.agentSessionJournal
          .settleInvocation({
            invocationId: invocation.dispatch.invocation.id,
            continuationId: invocation.dispatch.continuation.id,
            settlement: { settledAt: later, kind: "returned" },
            entry: {
              kind: "task_review_settlement",
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
            },
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      expect((yield* reviews.getById(admitted.review.id))?.agentInvocations ?? []).toMatchObject([
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
      expect(yield* getTaskInSqlite(publicTaskId("BY-1"))).toMatchObject({ state: "new" });
    }),
  ),
);

it.scoped("orders immutable Task Review history by its SQLite ID", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* createTaskInSqlite({ title: "Proposal", description: "Exact", now });

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
      const blockedInvocation = yield* reviews.agentSessionJournal.beginInvocation({
        configuration,
        createdAt: now,
        entry: {
          kind: "task_review_dispatch",
          taskId: publicTaskId("BY-1"),
          reviewId: first.review.id,
          admittedPolicy: first.policy,
        },
      });
      if (!blockedInvocation.ok) throw new Error(blockedInvocation.code);
      expect(
        yield* reviews.agentSessionJournal
          .settleInvocation({
            invocationId: blockedInvocation.dispatch.invocation.id,
            continuationId: blockedInvocation.dispatch.continuation.id,
            settlement: {
              settledAt: later,
              kind: "launch_failed",
              unusableReason: "The Agent did not return Findings.",
            },
            entry: {
              kind: "task_review_settlement",
              reviewId: first.review.id,
              findings: blockedFindings,
              now: later,
              complete: true,
            },
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      yield* reviews.agentSessionJournal.settleInvocation({
        invocationId: blockedInvocation.dispatch.invocation.id,
        continuationId: blockedInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "returned" },
        entry: {
          kind: "task_review_settlement",
          reviewId: first.review.id,
          findings: blockedFindings,
          now: later,
          complete: true,
        },
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
      const passedInvocation = yield* reviews.agentSessionJournal.beginInvocation({
        agentSessionId: blockedInvocation.dispatch.agentSessionId,
        configuration,
        createdAt: now,
        entry: {
          kind: "task_review_dispatch",
          taskId: publicTaskId("BY-1"),
          reviewId: second.review.id,
          admittedPolicy: second.policy,
        },
      });
      if (!passedInvocation.ok) throw new Error(passedInvocation.code);
      yield* reviews.agentSessionJournal.settleInvocation({
        invocationId: passedInvocation.dispatch.invocation.id,
        continuationId: passedInvocation.dispatch.continuation.id,
        settlement: { settledAt: later, kind: "returned" },
        entry: {
          kind: "task_review_settlement",
          reviewId: second.review.id,
          findings: [],
          now: later,
          complete: true,
        },
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
