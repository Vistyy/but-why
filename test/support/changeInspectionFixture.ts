import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";

import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";
import { createGitRepo } from "./by-cli.js";
import { withTestRepository } from "./repository.js";

// Change inspection evidence uses direct persisted Change, Candidate, and Validation Run
// fixtures in a real SQLite Shared Repository State. Real Git setup remains only where the
// claim needs Git identity or policy-source authority.
export const createInspectionRepository = (): string => {
  const root = createGitRepo();
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(
    join(root, ".but-why", "config.json"),
    `${JSON.stringify({ taskPrefix: "BY" }, null, 2)}\n`,
  );
  mkdirSync(join(root, ".git", "but-why"), { recursive: true });
  return root;
};

export type CreateChangeInspectionFixtureOptions = {
  readonly taskId?: string;
  readonly baseRef?: string | null;
  readonly worktreePath?: string | null;
  readonly startingCommit?: string | null;
};

export const createChangeFixture = (
  root: string,
  branchRef: string,
  createdAt: string,
  options: CreateChangeInspectionFixtureOptions = {},
): Effect.Effect<{ readonly id: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const id = randomUUID();
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Change inspection fixture",
        (sql) => sql`
          INSERT INTO changes (
            id, repository_common_directory, branch_ref, task_id, state,
            close_reason, created_at, updated_at, closed_at, base_ref,
            worktree_path, starting_commit
          ) VALUES (
            ${id}, ${join(root, ".git")}, ${branchRef}, ${options.taskId ?? null}, 'open',
            NULL, ${createdAt}, ${createdAt}, NULL, ${options.baseRef ?? null},
            ${options.worktreePath ?? null}, ${options.startingCommit ?? null}
          )
        `,
      );
      return { id };
    }),
  );

export const closeChangeFixture = (
  root: string,
  changeId: string,
  reason: "cancelled" | "completed",
  closedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "close Change inspection fixture",
        (sql) => sql`
          UPDATE changes
          SET state = 'closed',
              close_reason = ${reason},
              closed_at = ${closedAt},
              updated_at = ${closedAt},
              cleanup_state = 'pending'
          WHERE id = ${changeId}
        `,
      );
    }),
  );

export const captureCandidateFixture = (
  root: string,
  changeId: string,
  branchRef: string,
  headSha: string,
  capturedAt: string,
): Effect.Effect<{ readonly id: string; readonly headSha: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const capture = yield* openSqliteCandidateCapturePersistence();
      const result = yield* capture.commitCapture({
        repositoryCommonDirectory: join(root, ".git"),
        branchRef,
        expectedChangeId: changeId,
        baseRef: "refs/remotes/origin/main",
        changeBaseSha: "target-sha",
        headSha,
        now: capturedAt,
      });
      if (!result.ok) throw new Error(result.code);
      return { id: result.candidateId, headSha };
    }),
  );

export const completeChangeFixture = (
  root: string,
  changeId: string,
  headSha: string,
  now: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const changes = yield* openSqliteChangePersistence();
      const change = yield* changes.getChangeById(changeId);
      if (change === undefined) throw new Error("Change disappeared");
      const target = {
        owner: "acme",
        repo: "widgets",
        baseBranch: "main",
        remoteName: "origin",
      };
      const headBranch = change.branchRef.replace(/^refs\/heads\//, "");
      const publication = {
        changeId,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha: headSha,
        changeBaseSha: "base",
        now,
      };
      const begun = yield* changes.beginPublication(publication);
      if (!begun.ok) throw new Error(begun.code);
      const recorded = yield* changes.recordPublishedPullRequest({
        ...publication,
        pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
      });
      if (!recorded.ok) throw new Error(recorded.code);
      const result = yield* changes.completeMergedChange({
        changeId,
        now,
        observed: {
          repository: { owner: target.owner, repo: target.repo },
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          baseBranch: target.baseBranch,
          headBranch,
          mergedHeadSha: publication.expectedHeadSha,
          candidateId: publication.candidateId,
          validationRunId: publication.validationRunId,
          expectedHeadSha: publication.expectedHeadSha,
        },
      });
      if (!result.ok) throw new Error(result.code);
    }),
  );

export const withValidationPersistence = <A, E>(
  root: string,
  use: (persistence: ChangeValidationPersistence) => Effect.Effect<A, E>,
): Effect.Effect<A, E | RepositoryStorageError> =>
  Effect.flatMap(openSqliteChangeValidationPersistence(), use).pipe(
    Effect.provide(
      repositorySqlLayer({
        statePath: join(root, ".git", "but-why", "state.sqlite"),
        commonDirectory: join(root, ".git"),
      }),
    ),
  );
