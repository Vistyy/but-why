import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { ChangeReconciliationPort } from "../../src/change/changePorts.js";
import type { CompleteMergedChangeInput } from "../../src/change/changeStore.js";
import type { GitHubPullRequest } from "../../src/change/ownedPullRequestGateway.js";
import { openChangeReconciliation } from "../../src/change/reconcileChange.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import { passTaskReviewFixture, withTemporaryRepositoryState } from "../support/repository.js";
import {
  noOpTerminalCleanupDependencies,
  openTerminalCleanup,
} from "../support/terminalCleanup.js";

const pullRequestRead = <T>(pullRequest: T) => ({ ok: true as const, pullRequest });

const now = "2026-07-24T10:00:00.000Z";

const installPublicationIdentity = (changeId: string) =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    yield* repository.operation("install reconciliation publication identity", (sql) =>
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
          VALUES ('candidate-1', ${changeId}, 'base', 'head', ${now})
        `;
        yield* sql`
          INSERT INTO candidate_validation_runs (
            id, candidate_id, policy_snapshot, implementation_decisions,
            latest_resolved_blocker_id, state, outcome, created_at, updated_at
          ) VALUES (
            'validation-run-1', 'candidate-1',
            '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
            'complete', 'passed', ${now}, ${now}
          )
        `;
      }),
    );
  });

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
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "worktree"),
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.recordPrepareOutcome(created.change.id, null, now);
          const changes = yield* openSqliteChangeTestDependencies();
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "change-1",
            expectedHeadSha: "head",
            changeBaseSha: "base",
            now,
          };
          yield* installPublicationIdentity(created.change.id);
          const begun = yield* changes.publication.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          });
          if (!recorded.ok) throw new Error(recorded.code);
          const reconciliation = openChangeReconciliation({
            persistence: {
              getChangeById: changes.delivery.getChangeById,
              listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
              completeMergedChange: changes.delivery.completeMergedChange,
            },
            github: {
              getPullRequest: () =>
                pullRequestRead({
                  number: 42,
                  url: "https://github.com/acme/widgets/pull/42",
                  repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                  state: "closed",
                  merged: false,
                  baseBranch: publicationTarget.baseBranch,
                  headBranch: "change-1",
                  headSha: "head",
                }),
            },
            executionLock: { withLock: ({ effect }) => effect },
            cleanupTerminal: openTerminalCleanup({
              ...noOpTerminalCleanupDependencies,
              persistence: {
                recordCleanup: changes.delivery.recordCleanup,
                removeReviewerSessions: changes.reviewerSessions.removeReviewerSessions,
              },
              cleanup: () => {
                throw new Error("Open Changes must not be cleaned");
              },
            }),
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
          expect(yield* changes.reads.getChangeById(created.change.id)).toMatchObject({
            state: "open",
          });
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
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "worktree"),
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.recordPrepareOutcome(created.change.id, null, now);
          const changes = yield* openSqliteChangeTestDependencies();
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "change-1",
            expectedHeadSha: "head",
            changeBaseSha: "base",
            now,
          };
          yield* installPublicationIdentity(created.change.id);
          const begun = yield* changes.publication.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.publication.recordPublishedPullRequest({
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
            {
              ...expected,
              state: "closed",
              merged: false,
              headSha: "unexpected-closed-head",
            },
          ];

          for (const pullRequest of unexpected) {
            const reconciliation = openChangeReconciliation({
              persistence: {
                getChangeById: changes.delivery.getChangeById,
                listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
                completeMergedChange: changes.delivery.completeMergedChange,
              },
              github: {
                getPullRequest: () => pullRequestRead(pullRequest),
              },
              executionLock: { withLock: ({ effect }) => effect },
              cleanupTerminal: openTerminalCleanup({
                ...noOpTerminalCleanupDependencies,
                persistence: {
                  recordCleanup: changes.delivery.recordCleanup,
                  removeReviewerSessions: changes.reviewerSessions.removeReviewerSessions,
                },
                cleanup: () => {
                  throw new Error("Rejected Changes must not be cleaned");
                },
              }),
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
          expect(yield* changes.reads.getChangeById(created.change.id)).toMatchObject({
            state: "open",
          });
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
        yield* passTaskReviewFixture(taskId, now);

        const starts = yield* openSqliteChangeStartPersistence();
        const prepared = yield* starts.prepareTask(taskId);
        if (!prepared.ok) throw new Error(prepared.code);
        const created = yield* starts.create({
          id: "change-1",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/change-1",
          baseRef: "refs/heads/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "head",
          worktreePath: join(input.commonDirectory, "uncreated-worktree"),
          taskId,
          now,
        });
        if (!created.ok) throw new Error(created.code);
        yield* starts.recordPrepareOutcome(created.change.id, null, now);

        const changes = yield* openSqliteChangeTestDependencies();
        const publication = {
          changeId: created.change.id,
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          target: publicationTarget,
          headBranch: "but-why/change-1",
          expectedHeadSha: "head",
          changeBaseSha: "base",
          now,
        };
        yield* installPublicationIdentity(created.change.id);
        const begun = yield* changes.publication.beginPublication(publication);
        if (!begun.ok) throw new Error(begun.code);
        const recorded = yield* changes.publication.recordPublishedPullRequest({
          ...publication,
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        });
        if (!recorded.ok) throw new Error(recorded.code);

        const cleanupResults = [
          { state: "pending" as const, blockingReason: "remote_branch_deletion_failed" },
          { state: "complete" as const },
        ];
        let cleanupAttempts = 0;
        let mergedHead = "merged-head";
        const reconciliation = openChangeReconciliation({
          persistence: {
            getChangeById: changes.delivery.getChangeById,
            listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
            completeMergedChange: changes.delivery.completeMergedChange,
          },
          github: {
            getPullRequest: () =>
              pullRequestRead({
                number: 42,
                url: "https://github.com/acme/widgets/pull/42",
                repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                state: "closed",
                merged: true,
                baseBranch: publicationTarget.baseBranch,
                headBranch: "but-why/change-1",
                headSha: mergedHead,
              }),
          },
          executionLock: { withLock: ({ effect }) => effect },
          cleanupTerminal: openTerminalCleanup({
            ...noOpTerminalCleanupDependencies,
            persistence: {
              recordCleanup: changes.delivery.recordCleanup,
              removeReviewerSessions: changes.reviewerSessions.removeReviewerSessions,
            },
            cleanup: () => cleanupResults[cleanupAttempts++] ?? { state: "complete" },
          }),
        });

        expect(
          yield* reconciliation.reconcile({
            repositoryCommonDirectory: input.commonDirectory,
            changeId: created.change.id,
            now,
          }),
        ).toMatchObject({
          rejected: true,
          changes: [
            { changeId: created.change.id, status: "rejected", rejection: "merged_head_mismatch" },
          ],
        });
        expect(cleanupAttempts).toBe(0);
        mergedHead = "head";
        expect(
          yield* reconciliation.reconcile({
            repositoryCommonDirectory: input.commonDirectory,
            changeId: created.change.id,
            now,
          }),
        ).toMatchObject({
          rejected: false,
          changes: [
            {
              changeId: created.change.id,
              status: "completed",
              cleanup: { state: "pending", blockingReason: "remote_branch_deletion_failed" },
            },
          ],
        });
        expect(cleanupAttempts).toBe(1);
        expect(
          yield* reconciliation.reconcile({
            repositoryCommonDirectory: input.commonDirectory,
            changeId: created.change.id,
            now,
          }),
        ).toMatchObject({
          rejected: false,
          changes: [
            {
              changeId: created.change.id,
              status: "cleanup_complete",
              cleanup: { state: "complete" },
            },
          ],
        });
        expect(cleanupAttempts).toBe(2);
        expect(yield* changes.reads.getChangeById(created.change.id)).toMatchObject({
          state: "closed",
          closeReason: "completed",
        });
        const completedTask = yield* tasks.getTaskById(taskId);
        expect(completedTask).toMatchObject({ state: "done" });
      }),
    ),
  );

  it.effect(
    "completes a merged taskless Change through reconciliation",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const created = yield* starts.create({
            id: "change-taskless",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/but-why/change-taskless",
            baseRef: "refs/heads/main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "worktree"),
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.recordPrepareOutcome(created.change.id, null, now);
          const changes = yield* openSqliteChangeTestDependencies();
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "but-why/change-taskless",
            expectedHeadSha: "head",
            changeBaseSha: "base",
            now,
          };
          yield* installPublicationIdentity(created.change.id);
          const begun = yield* changes.publication.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          });
          if (!recorded.ok) throw new Error(recorded.code);
          const reconciliation = openChangeReconciliation({
            persistence: {
              getChangeById: changes.delivery.getChangeById,
              listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
              completeMergedChange: changes.delivery.completeMergedChange,
            },
            github: {
              getPullRequest: () =>
                pullRequestRead({
                  number: 42,
                  url: "https://github.com/acme/widgets/pull/42",
                  repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                  state: "closed",
                  merged: true,
                  baseBranch: publicationTarget.baseBranch,
                  headBranch: "but-why/change-taskless",
                  headSha: "head",
                }),
            },
            executionLock: { withLock: ({ effect }) => effect },
            cleanupTerminal: openTerminalCleanup({
              ...noOpTerminalCleanupDependencies,
              persistence: {
                recordCleanup: changes.delivery.recordCleanup,
                removeReviewerSessions: changes.reviewerSessions.removeReviewerSessions,
              },
              cleanup: () => ({ state: "complete", blockingReason: null }),
            }),
          });

          expect(
            yield* reconciliation.reconcile({
              repositoryCommonDirectory: input.commonDirectory,
              changeId: created.change.id,
              now,
            }),
          ).toMatchObject({
            rejected: false,
            changes: [
              {
                changeId: created.change.id,
                status: "completed",
                cleanup: { state: "complete" },
              },
            ],
          });
          expect(yield* changes.reads.getChangeById(created.change.id)).toMatchObject({
            state: "closed",
            closeReason: "completed",
            taskId: null,
          });
        }),
      ),
    15_000,
  );

  it.effect(
    "completes a merged Change with an unresolved Blocker without a synthetic Resolution",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const tasks = yield* openSqliteTaskPersistence("BY");
          const createdTask = yield* tasks.createTask({
            title: "Merged blocked Change",
            description: "Exact merge evidence outranks the historical Blocker.",
            now,
          });
          if (!createdTask.ok) throw new Error(createdTask.code);
          const taskId = publicTaskId(createdTask.task.id);
          yield* passTaskReviewFixture(taskId, now);

          const starts = yield* openSqliteChangeStartPersistence();
          const prepared = yield* starts.prepareTask(taskId);
          if (!prepared.ok) throw new Error(prepared.code);
          const created = yield* starts.create({
            id: "change-blocked-merged",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/but-why/change-blocked-merged",
            baseRef: "refs/heads/main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "uncreated-worktree"),
            taskId,
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.recordPrepareOutcome(created.change.id, null, now);
          const changes = yield* openSqliteChangeTestDependencies();
          const raised = yield* changes.authority.raiseImplementationBlocker({
            changeId: created.change.id,
            content: "Wait for an external decision that never arrived.",
            now,
          });
          if (!raised.ok) throw new Error(raised.code);
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "but-why/change-blocked-merged",
            expectedHeadSha: "head",
            changeBaseSha: "base",
            now,
          };
          yield* installPublicationIdentity(created.change.id);
          const begun = yield* changes.publication.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          });
          if (!recorded.ok) throw new Error(recorded.code);
          const reconciliation = openChangeReconciliation({
            persistence: {
              getChangeById: changes.delivery.getChangeById,
              listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
              completeMergedChange: changes.delivery.completeMergedChange,
            },
            github: {
              getPullRequest: () =>
                pullRequestRead({
                  number: 42,
                  url: "https://github.com/acme/widgets/pull/42",
                  repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                  state: "closed",
                  merged: true,
                  baseBranch: publicationTarget.baseBranch,
                  headBranch: "but-why/change-blocked-merged",
                  headSha: "head",
                }),
            },
            executionLock: { withLock: ({ effect }) => effect },
            cleanupTerminal: openTerminalCleanup({
              ...noOpTerminalCleanupDependencies,
              persistence: {
                recordCleanup: changes.delivery.recordCleanup,
                removeReviewerSessions: changes.reviewerSessions.removeReviewerSessions,
              },
              cleanup: () => ({ state: "complete", blockingReason: null }),
            }),
          });

          expect(
            yield* reconciliation.reconcile({
              repositoryCommonDirectory: input.commonDirectory,
              changeId: created.change.id,
              now,
            }),
          ).toMatchObject({
            rejected: false,
            changes: [
              {
                changeId: created.change.id,
                status: "completed",
                cleanup: { state: "complete" },
              },
            ],
          });
          expect(yield* changes.reads.getChangeById(created.change.id)).toMatchObject({
            state: "closed",
            closeReason: "completed",
          });
          expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "done" });
          expect(
            yield* changes.authority.listImplementationBlockers(created.change.id),
          ).toMatchObject({
            active: { content: "Wait for an external decision that never arrived." },
            resolutions: [],
          });
        }),
      ),
    15_000,
  );

  it.effect(
    "observes the owned pull request once and derives the linked Task without transition input",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const tasks = yield* openSqliteTaskPersistence("BY");
          const createdTask = yield* tasks.createTask({
            title: "Single observation",
            description: "Completion derives the linked Task from durable Change state.",
            now,
          });
          if (!createdTask.ok) throw new Error(createdTask.code);
          const taskId = publicTaskId(createdTask.task.id);
          yield* passTaskReviewFixture(taskId, now);

          const starts = yield* openSqliteChangeStartPersistence();
          const prepared = yield* starts.prepareTask(taskId);
          if (!prepared.ok) throw new Error(prepared.code);
          const created = yield* starts.create({
            id: "change-single-observation",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/but-why/change-single-observation",
            baseRef: "refs/heads/main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "head",
            worktreePath: join(input.commonDirectory, "worktree"),
            taskId,
            now,
          });
          if (!created.ok) throw new Error(created.code);
          yield* starts.recordPrepareOutcome(created.change.id, null, now);
          const changes = yield* openSqliteChangeTestDependencies();
          const publication = {
            changeId: created.change.id,
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            target: publicationTarget,
            headBranch: "but-why/change-single-observation",
            expectedHeadSha: "head",
            changeBaseSha: "base",
            now,
          };
          yield* installPublicationIdentity(created.change.id);
          const begun = yield* changes.publication.beginPublication(publication);
          if (!begun.ok) throw new Error(begun.code);
          const recorded = yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          });
          if (!recorded.ok) throw new Error(recorded.code);

          let pullRequestObservations = 0;
          let capturedInput: CompleteMergedChangeInput | undefined;
          const persistence: ChangeReconciliationPort = {
            getChangeById: changes.delivery.getChangeById,
            listChangesForReconciliation: changes.delivery.listChangesForReconciliation,
            completeMergedChange: (input) => {
              capturedInput = input;
              return changes.delivery.completeMergedChange(input);
            },
          };
          const reconciliation = openChangeReconciliation({
            persistence,
            github: {
              getPullRequest: () => {
                pullRequestObservations += 1;
                return pullRequestRead({
                  number: 42,
                  url: "https://github.com/acme/widgets/pull/42",
                  repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                  state: "closed",
                  merged: true,
                  baseBranch: publicationTarget.baseBranch,
                  headBranch: "but-why/change-single-observation",
                  headSha: "head",
                });
              },
            },
            executionLock: { withLock: ({ effect }) => effect },
            cleanupTerminal: openTerminalCleanup({
              ...noOpTerminalCleanupDependencies,
              persistence: {
                recordCleanup: changes.delivery.recordCleanup,
                removeReviewerSessions: changes.reviewerSessions.removeReviewerSessions,
              },
              cleanup: () => ({ state: "complete", blockingReason: null }),
            }),
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
          expect(pullRequestObservations).toBe(1);
          expect(capturedInput?.observed).toEqual({
            repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
            baseBranch: publicationTarget.baseBranch,
            headBranch: "but-why/change-single-observation",
            mergedHeadSha: "head",
            candidateId: "candidate-1",
            validationRunId: "validation-run-1",
            expectedHeadSha: "head",
          });
          expect("taskId" in (capturedInput ?? {})).toBe(false);
          expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "done" });
        }),
      ),
    15_000,
  );
});

const publicationTarget = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
} as const;
