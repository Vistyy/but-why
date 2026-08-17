import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { internalTaskId, type PublicTaskId } from "../../src/task/taskId.js";

const taskReviewPolicyFixture = {
  profile: {
    agentProfile: "review",
    scope: "global" as const,
    profile: { agentRuntime: "pi" as const },
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

export const passTaskReviewFixture = (
  mainCheckoutRoot: string,
  taskId: PublicTaskId,
  now: string,
) =>
  Effect.gen(function* () {
    const reviews = yield* openSqliteTaskReviewPersistence(mainCheckoutRoot);
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
    const completed = yield* reviews.complete({ reviewId, findings: [], now });
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
    readonly mainCheckoutRoot: string;
    readonly commonDirectory: string;
    readonly statePath: string;
  }) => Effect.Effect<A, E, RepositorySql>,
): Effect.Effect<A, E | RepositoryStorageError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
    (directory) => {
      const mainCheckoutRoot = join(directory, "main");
      const commonDirectory = join(directory, "git-common");
      const statePath = join(commonDirectory, "state.sqlite");
      mkdirSync(mainCheckoutRoot);
      mkdirSync(commonDirectory);
      return use({ mainCheckoutRoot, commonDirectory, statePath }).pipe(
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
