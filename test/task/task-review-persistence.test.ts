import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteAgentSessionPersistence } from "../../src/sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

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

it.scoped(
  "captures exact Task Review proposal and dependency evidence with one Active Review",
  () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const reviews = yield* openSqliteTaskReviewPersistence();
        yield* tasks.createTask({ title: "Dependency", description: "Observed dependency", now });
        yield* tasks.createTask({
          title: "Proposal",
          description: "Exact description",
          dependsOn: [publicTaskId("BY-1")],
          now,
        });
        const admitted = yield* reviews.admit({
          reviewId: "review-1",
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: "/tmp/review-1",
          now,
        });
        expect(admitted).toMatchObject({
          ok: true,
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
            reviewId: "review-2",
            taskId: publicTaskId("BY-2"),
            policy,
            baseRef: "refs/heads/main",
            baseCommit: "a".repeat(40),
            workspacePath: "/tmp/review-2",
            now,
          }),
        ).toEqual({ ok: false, code: "active_task_review", reviewId: "review-1" });
      }),
    ),
);

it.scoped("selects the latest Review deterministically when creation times match", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-first",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-first",
        now,
      });
      yield* reviews.recordCleanup("review-first", "removed", now);
      yield* reviews.complete({
        reviewId: "review-first",
        findings: [
          {
            title: "Finding",
            description: "Description",
            evidence: "Evidence",
            files: [],
          },
        ],
        now,
      });
      yield* reviews.admit({
        reviewId: "review-second",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        workspacePath: "/tmp/review-second",
        now,
      });

      expect(yield* reviews.getLatestForTask(publicTaskId("BY-1"))).toMatchObject({
        id: "review-second",
        state: "running",
      });
    }),
  ),
);

it.scoped("rejects Task Review admission for a Change-linked New Task", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* tasks.createTask({ title: "Linked proposal", description: "Exact", now });
      yield* repository.operation(
        "link New Task fixture to Change",
        (sql) =>
          sql`INSERT INTO changes (
          id, repository_common_directory, branch_ref, state, acceptance_context,
          base_ref, base_remote_url, starting_commit, worktree_path, created_at, updated_at
        ) VALUES (
          'change-linked', '/repo/.git', 'refs/heads/change-linked', 'open',
          '{"version":1,"title":"Linked proposal","description":"Exact"}',
          'refs/remotes/origin/main', 'https://example.test/repo.git', ${"a".repeat(40)},
          '/repo-worktrees/change-linked', ${now}, ${now}
        )`,
      );
      yield* repository.operation(
        "link New Task fixture to Change",
        (sql) => sql`
          INSERT INTO task_change_links (task_id, change_id)
          VALUES ('BY-1', 'change-linked')
        `,
      );

      expect(
        yield* reviews.admit({
          reviewId: "review-rejected",
          taskId: publicTaskId("BY-1"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: "/tmp/review-rejected",
          now,
        }),
      ).toEqual({ ok: false, code: "task_change_linked", changeId: "change-linked" });
      expect(yield* reviews.listForTask(publicTaskId("BY-1"))).toEqual([]);
    }),
  ),
);

it.scoped("does not reuse Finding-blocked or tooling-failed Reviews after an earlier pass", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* tasks.createTask({ title: "Dependency", description: "Original", now });
      yield* tasks.createTask({
        title: "Proposal",
        description: "Exact",
        dependsOn: [publicTaskId("BY-1")],
        now,
      });
      yield* reviews.admit({
        reviewId: "review-passed",
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/review-passed",
        baseCommit: "p".repeat(40),
        workspacePath: "/tmp/review-passed",
        now,
      });
      yield* reviews.recordCleanup("review-passed", "removed", later);
      yield* reviews.complete({ reviewId: "review-passed", findings: [], now: later });
      yield* repository.operation(
        "restore New Task after earlier passing Review",
        (sql) => sql`UPDATE tasks SET state = 'new' WHERE id = 'BY-2'`,
      );
      const finding = (title: string) => ({
        title,
        description: `${title} description`,
        evidence: `${title} evidence`,
        files: [],
      });
      for (const input of [
        { id: "review-old", findings: [finding("Old")] },
        { id: "review-new", findings: [finding("New")] },
        {
          id: "review-tooling",
          findings: [],
          toolingFailure: { operation: "review", message: "Unavailable" },
        },
      ]) {
        yield* reviews.admit({
          reviewId: input.id,
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: `refs/heads/${input.id}`,
          baseCommit: input.id.padEnd(40, "a"),
          workspacePath: `/tmp/${input.id}`,
          now,
        });
        yield* reviews.recordCleanup(input.id, "removed", later);
        yield* reviews.complete({
          reviewId: input.id,
          findings: input.findings,
          ...(input.toolingFailure === undefined ? {} : { toolingFailure: input.toolingFailure }),
          now: later,
        });
      }
      yield* tasks.updateTaskContext({
        taskId: publicTaskId("BY-2"),
        description: "Different proposal",
        now: later,
      });
      yield* reviews.admit({
        reviewId: "review-nonmatching",
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/nonmatching",
        baseCommit: "d".repeat(40),
        workspacePath: "/tmp/review-nonmatching",
        now: later,
      });
      yield* reviews.recordCleanup("review-nonmatching", "removed", later);
      yield* reviews.complete({
        reviewId: "review-nonmatching",
        findings: [finding("Nonmatching")],
        now: later,
      });
      yield* tasks.updateTaskContext({
        taskId: publicTaskId("BY-2"),
        description: "Exact",
        now: later,
      });
      yield* repository.operation(
        "malform excluded Review evidence",
        (sql) =>
          sql`UPDATE task_reviews SET policy_snapshot = '{'
            WHERE id IN ('review-tooling', 'review-nonmatching')`,
      );
      yield* repository.operation(
        "change irrelevant dependency evidence",
        (sql) =>
          sql`UPDATE tasks SET title = 'Renamed dependency', description = 'Changed', state = 'done'
              WHERE id = 'BY-1'`,
      );

      expect(yield* reviews.reuseJudgment(publicTaskId("BY-2"), later)).toBeUndefined();

      yield* tasks.updateTaskContext({
        taskId: publicTaskId("BY-2"),
        description: "Changed proposal",
        now: later,
      });
      expect(yield* reviews.reuseJudgment(publicTaskId("BY-2"), later)).toBeUndefined();
      yield* tasks.updateTaskContext({
        taskId: publicTaskId("BY-2"),
        description: "Exact",
        now: later,
      });
      yield* repository.operation(
        "change direct dependency set",
        (sql) =>
          sql`DELETE FROM task_dependencies
              WHERE dependent_task_id = 'BY-2' AND prerequisite_task_id = 'BY-1'`,
      );
      expect(yield* reviews.reuseJudgment(publicTaskId("BY-2"), later)).toBeUndefined();
      yield* repository.operation(
        "restore direct dependency set",
        (sql) =>
          sql`INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
            VALUES ('BY-2', 'BY-1')`,
      );
      yield* reviews.admit({
        reviewId: "review-active",
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/active",
        baseCommit: "c".repeat(40),
        workspacePath: "/tmp/review-active",
        now: later,
      });
      expect(yield* reviews.reuseJudgment(publicTaskId("BY-2"), later)).toBeUndefined();
    }),
  ),
);

it.scoped("atomically applies a reused passing judgment and rejects malformed evidence", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const repository = yield* RepositorySql;
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-passed",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-passed",
        now,
      });
      yield* reviews.recordCleanup("review-passed", "removed", later);
      yield* reviews.complete({ reviewId: "review-passed", findings: [], now: later });
      yield* repository.operation(
        "restore New Task fixture",
        (sql) => sql`UPDATE tasks SET state = 'new' WHERE id = 'BY-1'`,
      );

      expect(yield* reviews.reuseJudgment(publicTaskId("BY-1"), later)).toMatchObject({
        ok: true,
        outcome: "passed",
        review: { id: "review-passed", baseCommit: "a".repeat(40) },
        task: { id: "BY-1", state: "todo" },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "todo" });

      yield* repository.operation("malform reusable Review evidence", (sql) =>
        Effect.gen(function* () {
          yield* sql`UPDATE tasks SET state = 'new' WHERE id = 'BY-1'`;
          yield* sql`UPDATE task_reviews SET proposal_snapshot = '{' WHERE id = 'review-passed'`;
        }),
      );
      const malformed = yield* Effect.either(reviews.reuseJudgment(publicTaskId("BY-1"), later));
      expect(malformed._tag).toBe("Left");
      if (malformed._tag === "Left") {
        expect(malformed.left).toMatchObject({
          _tag: "RepositoryPersistedDataInvalid",
          operationName: "read Task Review",
        });
      }
    }),
  ),
);

it.scoped("atomically moves a Task to Todo only for a passing exact Task Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Approved", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-passed",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-passed",
        now,
      });
      yield* reviews.recordCleanup("review-passed", "removed", later);

      const completed = yield* reviews.complete({
        reviewId: "review-passed",
        findings: [],
        now: later,
      });

      expect(completed).toMatchObject({
        ok: true,
        outcome: "passed",
        review: { outcome: "passed" },
        task: { id: "BY-1", state: "todo" },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "todo" });
      expect(
        yield* reviews.complete({ reviewId: "review-passed", findings: [], now: later }),
      ).toEqual({ ok: false, code: "task_review_not_active" });
    }),
  ),
);

it.scoped("leaves Finding-blocked and tooling-failed Tasks New", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      for (const [sequence, completion] of [
        {
          findings: [
            {
              title: "Finding",
              description: "Description",
              evidence: "Evidence",
              files: [],
            },
          ],
        },
        {
          findings: [],
          toolingFailure: { operation: "run_task_review", message: "Reviewer failed." },
        },
      ].entries()) {
        const taskId = publicTaskId(`BY-${sequence + 1}`);
        const reviewId = `review-${sequence + 1}`;
        yield* tasks.createTask({ title: `Proposal ${sequence + 1}`, description: "Exact", now });
        yield* reviews.admit({
          reviewId,
          taskId,
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: `/tmp/${reviewId}`,
          now,
        });
        yield* reviews.recordCleanup(reviewId, "removed", later);
        const completed = yield* reviews.complete({ reviewId, ...completion, now: later });
        expect(completed).toMatchObject({
          ok: true,
          outcome: reviewId === "review-1" ? "blocked" : "tooling_failed",
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "new" });
      }
    }),
  ),
);

it.scoped(
  "records the exact incomplete-submission reason when Task state changes during review",
  () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const reviews = yield* openSqliteTaskReviewPersistence();
        yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
        yield* reviews.admit({
          reviewId: "review-cancelled",
          taskId: publicTaskId("BY-1"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: "/tmp/review-cancelled",
          now,
        });
        yield* tasks.cancelTask({ taskId: publicTaskId("BY-1"), reason: "Superseded", now: later });
        yield* reviews.recordCleanup("review-cancelled", "removed", later);

        const completed = yield* reviews.complete({
          reviewId: "review-cancelled",
          findings: [],
          now: later,
        });

        expect(completed).toMatchObject({
          ok: true,
          outcome: "tooling_failed",
          review: {
            outcome: "tooling_failed",
            toolingFailure: {
              operation: "confirm_task_review_task_state",
              message: "Task state changed from new to cancelled during review.",
            },
          },
        });
      }),
    ),
);

it.scoped("returns the exact abandonment reason to a stale Task Submission completion", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-abandoned",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-abandoned",
        now,
      });
      yield* reviews.recordCleanup("review-abandoned", "removed", later);
      yield* reviews.abandon("review-abandoned", "Reviewer process stopped", later);

      const staleCompletion = yield* reviews.complete({
        reviewId: "review-abandoned",
        findings: [],
        now: later,
      });

      expect(staleCompletion).toMatchObject({
        ok: true,
        outcome: "tooling_failed",
        review: {
          outcome: "tooling_failed",
          toolingFailure: {
            operation: "task_review_abandoned",
            message: "Reviewer process stopped",
          },
        },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "new" });

      yield* tasks.createTask({ title: "Completed first", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-completed-first",
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-completed-first",
        now,
      });
      yield* reviews.recordCleanup("review-completed-first", "removed", later);
      yield* reviews.complete({
        reviewId: "review-completed-first",
        findings: [],
        toolingFailure: { operation: "run_task_review", message: "Reviewer failed" },
        now: later,
      });
      expect(
        yield* reviews.abandon("review-completed-first", "Too late to abandon", later),
      ).toEqual({ ok: false, code: "task_review_not_active" });
    }),
  ),
);

it.scoped("recovers an unsettled Agent Invocation when a Task Review is abandoned", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const agents = yield* openSqliteAgentSessionPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      const admitted = yield* reviews.admit({
        reviewId: "review-interrupted",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-interrupted",
        now,
      });
      if (!admitted.ok) throw new Error(`Could not admit Review: ${admitted.code}`);
      const linkAgentInvocation = reviews.linkAgentInvocation;
      if (linkAgentInvocation === undefined) throw new Error("Agent linking is unavailable");
      const configuration = {
        harness: "pi" as const,
        model: "test-model",
        thinking: "off" as const,
      };
      const started = yield* agents.beginInvocation({
        configuration,
        createdAt: now,
        linkInvocation: linkAgentInvocation({
          taskId: publicTaskId("BY-1"),
          reviewId: "review-interrupted",
          configuration,
          configurationSnapshot: policy,
        }),
      });
      if (!started.ok) throw new Error(`Could not start Invocation: ${started.code}`);

      yield* reviews.abandon("review-interrupted", "Reviewer process stopped", later);

      const history = yield* agents.readInvocationHistory(started.dispatch.agentSessionId);
      expect(history).toMatchObject([
        {
          settlementKind: "return_unknown",
          settledAt: later,
          usage: null,
          continuation: {
            unusableReason: expect.stringContaining("Reviewer process stopped"),
          },
        },
      ]);
      const replacement = yield* agents.beginInvocation({
        agentSessionId: started.dispatch.agentSessionId,
        configuration,
        createdAt: later,
        linkInvocation: () => Effect.succeed(undefined),
      });
      expect(replacement).toMatchObject({ ok: true, dispatch: { resumed: false } });
    }),
  ),
);

it.scoped("finalizes a concurrently changed proposal as tooling failed and retains Findings", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Before", now });
      const admitted = yield* reviews.admit({
        reviewId: "review-stale",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        workspacePath: "/tmp/review-stale",
        now,
      });
      expect(admitted.ok).toBe(true);
      yield* tasks.updateTaskContext({
        taskId: publicTaskId("BY-1"),
        description: "After",
        now: later,
      });
      yield* reviews.recordCleanup("review-stale", "removed", later);
      const completed = yield* reviews.complete({
        reviewId: "review-stale",
        findings: [
          {
            title: "Finding",
            description: "Description",
            evidence: "Evidence",
            files: [],
          },
        ],
        now: later,
      });
      expect(completed).toMatchObject({
        ok: true,
        review: {
          state: "complete",
          outcome: "tooling_failed",
          findings: [
            {
              title: "Finding",
              description: "Description",
              evidence: "Evidence",
              files: [],
            },
          ],
          toolingFailure: { operation: "confirm_task_review_context" },
        },
      });
    }),
  ),
);
