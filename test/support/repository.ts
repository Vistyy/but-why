import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { openSqliteAgentSessionPersistence } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import {
  RepositorySql,
  repositorySqlLayer,
} from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { internalTaskId, type PublicTaskId } from "../../src/task/taskId.js";

const taskReviewPolicyFixture = {
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

export const passTaskReviewFixture = (_repositoryRoot: string, taskId: PublicTaskId, now: string) =>
  Effect.gen(function* () {
    const agents = yield* openSqliteAgentSessionPersistence();
    const reviews = yield* openSqliteTaskReviewPersistence();
    const admitted = yield* reviews.admit({
      taskId,
      policy: taskReviewPolicyFixture,
      baseRef: "refs/heads/main",
      baseCommit: "a".repeat(40),
      now,
    });
    if (!admitted.ok)
      throw new Error(`Could not admit passing Task Review fixture: ${admitted.code}`);
    const reviewId = admitted.review.id;
    yield* reviews.recordCleanup(reviewId, "removed", now);
    const configuration = { harness: "pi" as const, model: "test-model" };
    const invocation = yield* agents.beginInvocation({
      configuration,
      createdAt: now,
      linkInvocation: reviews.linkAgentInvocation({
        taskId,
        reviewId,
        admittedPolicy: admitted.policy,
      }),
    });
    if (!invocation.ok)
      throw new Error(`Could not dispatch Task Review fixture: ${invocation.code}`);
    yield* agents.settleInvocation({
      invocationId: invocation.dispatch.invocation.id,
      continuationId: invocation.dispatch.continuation.id,
      settlement: { settledAt: now, kind: "returned" },
      settleDomain: reviews.settleAgentReview({
        reviewId,
        findings: [],
        now,
        complete: true,
      }),
    });
    const completed = yield* reviews.complete({
      reviewId,
      findings: [],
      now,
    });
    if (!completed.ok || completed.outcome !== "passed") {
      throw new Error("Could not complete passing Task Review fixture");
    }
    return completed;
  });

export const setTerminalTaskStateFixture = (
  taskId: PublicTaskId,
  state: "done" | "cancelled",
  _updatedAt: string,
  cancelReason: string | null = state === "cancelled" ? "Cancelled fixture" : null,
) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.operation(
      "set terminal Task fixture state",
      (sql) => sql`
        UPDATE tasks
        SET state = ${state}, cancel_reason = ${cancelReason}
        WHERE id = ${internalTaskId(taskId, repository.idPrefix)}
      `,
    ),
  );

export const testRepositoryConfig = (root: string) => ({
  commonDirectory: join(root, ".git"),
  statePath: join(root, ".git", "but-why", "state.sqlite"),
  lifecycle: "initialize" as const,
});

export const withTestRepository = <A, E, R>(
  root: string,
  program: Effect.Effect<A, E, RepositorySql | R>,
) => Effect.scoped(program.pipe(Effect.provide(repositorySqlLayer(testRepositoryConfig(root)))));

export const withTemporaryRepositoryState = <A, E>(
  use: (input: {
    readonly repositoryRoot: string;
    readonly commonDirectory: string;
    readonly statePath: string;
  }) => Effect.Effect<A, E, RepositorySql>,
): Effect.Effect<A, E | RepositoryStorageError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
    (directory) => {
      const repositoryRoot = join(directory, "main");
      const commonDirectory = join(directory, "git-common");
      const statePath = join(commonDirectory, "state.sqlite");
      mkdirSync(repositoryRoot);
      mkdirSync(commonDirectory);
      return use({ repositoryRoot, commonDirectory, statePath }).pipe(
        Effect.provide(
          repositorySqlLayer({
            commonDirectory,
            statePath,
            lifecycle: "initialize",
          }),
        ),
      );
    },
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );
