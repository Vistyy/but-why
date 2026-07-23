import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { openChangeReconciliation } from "../src/change/reconcileChange.js";
import type { GitHubPullRequest } from "../src/change/ownedPullRequestGateway.js";
import { openSqliteChangePersistence } from "../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskPersistence } from "../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../src/task/taskId.js";
import { withTemporaryRepositoryState } from "./support/repository.js";

const now = "2026-07-24T10:00:00.000Z";
describe("by change reconcile", () => {
  it.effect(
    "leaves a closed unmerged owned pull request and its Change open",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const created = yield* starts.create({
            id: "change-1",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/change-1",
            baseRef: "refs/heads/main",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "worktree"),
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.markReady(created.change.id, now);
          const changes = yield* openSqliteChangePersistence();
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "change-1",
            expectedHeadSha: "head",
            now,
          };
          const begun = yield* changes.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          });
          if (!recorded.ok) throw new Error(recorded.code);
          const reconciliation = openChangeReconciliation({
            persistence: changes,
            github: {
              findPullRequests: () => [],
              getPullRequest: () => ({
                number: 42,
                url: "https://github.com/acme/widgets/pull/42",
                repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                state: "closed",
                merged: false,
                baseBranch: publicationTarget.baseBranch,
                headBranch: "change-1",
                headSha: "head",
              }),
              createPullRequest: () => {
                throw new Error("Reconciliation must not create a pull request");
              },
              updatePullRequest: () => {
                throw new Error("Reconciliation must not update a pull request");
              },
            },
            cleanup: () => {
              throw new Error("Open Changes must not be cleaned");
            },
          });

          expect(
            yield* reconciliation.reconcile({
              repositoryCommonDirectory: input.commonDirectory,
              changeId: created.change.id,
              now,
            }),
          ).toEqual({
            rejected: false,
            changes: [
              {
                changeId: created.change.id,
                status: "closed_unmerged",
                pullRequest: {
                  number: 42,
                  url: "https://github.com/acme/widgets/pull/42",
                },
              },
            ],
          });
          expect(yield* changes.getChangeById(created.change.id)).toMatchObject({ state: "open" });
        }),
      ),
    15_000,
  );

  it.effect(
    "rejects unexpected pull request ownership facts without adopting them",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const created = yield* starts.create({
            id: "change-1",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/change-1",
            baseRef: "refs/heads/main",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "worktree"),
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.markReady(created.change.id, now);
          const changes = yield* openSqliteChangePersistence();
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "change-1",
            expectedHeadSha: "head",
            now,
          };
          const begun = yield* changes.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          });
          if (!recorded.ok) throw new Error(recorded.code);
          const expected: GitHubPullRequest = {
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
            state: "open",
            merged: false,
            baseBranch: publicationTarget.baseBranch,
            headBranch: "change-1",
            headSha: "head",
          };
          const unexpected: readonly GitHubPullRequest[] = [
            { ...expected, repository: { owner: "other", repo: publicationTarget.repo } },
            { ...expected, baseBranch: "release" },
            { ...expected, headBranch: "other-feature" },
            { ...expected, headSha: "unexpected-head" },
          ];

          for (const pullRequest of unexpected) {
            const reconciliation = openChangeReconciliation({
              persistence: changes,
              github: {
                findPullRequests: () => [],
                getPullRequest: () => pullRequest,
                createPullRequest: () => {
                  throw new Error("Reconciliation must not create a pull request");
                },
                updatePullRequest: () => {
                  throw new Error("Reconciliation must not update a pull request");
                },
              },
              cleanup: () => {
                throw new Error("Rejected Changes must not be cleaned");
              },
            });
            expect(
              yield* reconciliation.reconcile({
                repositoryCommonDirectory: input.commonDirectory,
                changeId: created.change.id,
                now,
              }),
            ).toMatchObject({
              rejected: true,
              changes: [{ changeId: created.change.id, status: "rejected" }],
            });
          }
          expect(yield* changes.getChangeById(created.change.id)).toMatchObject({ state: "open" });
        }),
      ),
    30_000,
  );

  it.effect("atomically completes a merged Change and its linked Task before cleanup", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const createdTask = yield* tasks.createTask({
          title: "Merged Change",
          description: "Complete me",
          now,
        });
        if (!createdTask.ok) throw new Error(createdTask.code);
        const taskId = publicTaskId(createdTask.task.id);
        const approved = yield* tasks.approveTask({ taskId, now });
        if (!approved.ok) throw new Error(approved.code);

        const starts = yield* openSqliteChangeStartPersistence();
        const prepared = yield* starts.prepareTask(taskId);
        if (!prepared.ok) throw new Error(prepared.code);
        const created = yield* starts.create({
          id: "change-1",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-1",
          baseRef: "refs/heads/main",
          startingCommit: "head",
          worktreePath: join(input.commonDirectory, "worktree"),
          taskId,
          now,
        });
        if (!created.ok) throw new Error(created.code);
        yield* starts.markReady(created.change.id, now);

        const changes = yield* openSqliteChangePersistence();
        const publication = {
          changeId: created.change.id,
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          target: publicationTarget,
          headBranch: "change-1",
          expectedHeadSha: "head",
          now,
        };
        const begun = yield* changes.beginPublication(publication);
        if (!begun.ok) throw new Error(begun.code);
        const recorded = yield* changes.recordPublishedPullRequest({
          ...publication,
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        });
        if (!recorded.ok) throw new Error(recorded.code);

        const reconciliation = openChangeReconciliation({
          persistence: changes,
          github: {
            findPullRequests: () => [],
            getPullRequest: () => ({
              number: 42,
              url: "https://github.com/acme/widgets/pull/42",
              repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
              state: "closed",
              merged: true,
              baseBranch: publicationTarget.baseBranch,
              headBranch: "change-1",
              headSha: "head",
            }),
            createPullRequest: () => {
              throw new Error("Reconciliation must not create a pull request");
            },
            updatePullRequest: () => {
              throw new Error("Reconciliation must not update a pull request");
            },
          },
          cleanup: () => ({ state: "complete" }),
        });

        expect(
          yield* reconciliation.reconcile({
            repositoryCommonDirectory: input.commonDirectory,
            changeId: created.change.id,
            now,
          }),
        ).toMatchObject({
          rejected: false,
          changes: [{ changeId: created.change.id, status: "completed" }],
        });
        expect(yield* changes.getChangeById(created.change.id)).toMatchObject({
          state: "closed",
          closeReason: "completed",
          cleanup: { state: "complete", blockingReason: null },
        });
        const completedTask = yield* tasks.getTaskById(taskId);
        expect(completedTask).toMatchObject({ state: "done" });
      }),
    ),
  );
});

const publicationTarget = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
} as const;
