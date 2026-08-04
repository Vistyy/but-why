import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { describe } from "vitest";

import { storedPublicTaskId } from "../../src/task/taskId.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
} from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { withTemporaryRepositoryState as withTemporaryState } from "../support/repository.js";

const migrationCount = Effect.gen(function* () {
  const repositorySql = yield* RepositorySql;
  const rows = yield* repositorySql.operation(
    "count repository migrations",
    (sql) => sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM effect_sql_migrations
    `,
  );
  return rows[0]?.count ?? -1;
});

describe("repository SQL storage", () => {
  it.scoped("persists Tasks through the Effect-native Task interface", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const created = yield* tasks.createTask({
          title: "Effect-native Task",
          description: "Persist this Task through repository SQL.",
          now: "2026-07-17T22:45:00.000Z",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const stored = yield* tasks.getTaskById(storedPublicTaskId(created.task.id));

        expect(stored).toMatchObject({
          id: "BY-1",
          title: "Effect-native Task",
          state: "new",
        });
      }),
    ),
  );

  it.scoped("rolls back Task-backed Change Start when the Task transition fails", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const changes = yield* openSqliteChangeStartPersistence();
        const created = yield* tasks.createTask({
          title: "Atomic Change Start",
          description: "The Change and Task transition commit together.",
          now: "2026-07-17T22:50:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:51:00.000Z" });

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "install Task transition failure",
          (sql) => sql`
            CREATE TRIGGER reject_change_start_task_transition
            BEFORE UPDATE OF state ON tasks
            WHEN NEW.state = 'implementing'
            BEGIN
              SELECT RAISE(ABORT, 'deliberate Task transition failure');
            END
          `,
        );

        yield* changes
          .create({
            id: "change-atomic",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/but-why/by-1",
            baseRef: "main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "1111111111111111111111111111111111111111",
            worktreePath: join(input.commonDirectory, "worktrees", "by-1"),
            taskId,
            now: "2026-07-17T22:52:00.000Z",
          })
          .pipe(Effect.flip);

        expect(yield* changes.getById("change-atomic")).toBeUndefined();
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });
      }),
    ),
  );

  it.scoped("rejects a Task-backed blocker when its linked Task is not Implementing", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const created = yield* tasks.createTask({
          title: "Reject mismatched blocker",
          description: "Keep the Change unchanged when its Task state is inconsistent.",
          now: "2026-07-17T22:53:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:54:00.000Z" });
        const started = yield* starts.create({
          id: "change-mismatched-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-mismatched-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-mismatched-blocker"),
          taskId,
          now: "2026-07-17T22:55:00.000Z",
        });
        if (!started.ok) return;

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "create mismatched linked Task state",
          (sql) => sql`UPDATE tasks SET state = 'blocked' WHERE id = ${taskId}`,
        );

        const error = yield* changes
          .raiseImplementationBlocker({
            changeId: started.change.id,
            content: "This blocker must not be recorded.",
            now: "2026-07-17T22:56:00.000Z",
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({ operationName: "raise Implementation Blocker" });
        expect(yield* changes.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: null,
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "blocked" });
        expect(yield* changes.listImplementationBlockers(started.change.id)).toEqual({
          blockers: [],
          resolutions: [],
          active: null,
        });
      }),
    ),
  );

  it.scoped("rejects a Resolution when its linked Task is not Blocked", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const created = yield* tasks.createTask({
          title: "Reject mismatched Resolution",
          description: "Keep the blocker active when its Task state is inconsistent.",
          now: "2026-07-17T22:57:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:58:00.000Z" });
        const started = yield* starts.create({
          id: "change-mismatched-resolution",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-mismatched-resolution",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-mismatched-resolution"),
          taskId,
          now: "2026-07-17T22:59:00.000Z",
        });
        if (!started.ok) return;
        const raised = yield* changes.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for approved intent.",
          now: "2026-07-17T23:00:00.000Z",
        });
        if (!raised.ok) return;

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "create mismatched linked Task state",
          (sql) => sql`UPDATE tasks SET state = 'implementing' WHERE id = ${taskId}`,
        );

        const error = yield* changes
          .resolveImplementationBlocker({
            changeId: started.change.id,
            content: "Use the approved approach.",
            now: "2026-07-17T23:01:00.000Z",
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({ operationName: "resolve Implementation Blocker" });
        const unchanged = yield* changes.getChangeById(started.change.id);
        expect(unchanged).toMatchObject({
          state: "blocked",
          activeBlocker: { id: raised.blocker.id, resolvedAt: null },
        });
        expect(unchanged?.acceptanceContext).toEqual({
          version: 1,
          title: "Reject mismatched Resolution",
          description: "Keep the blocker active when its Task state is inconsistent.",
          comments: [],
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "implementing" });
        expect(yield* changes.listImplementationBlockers(started.change.id)).toMatchObject({
          resolutions: [],
          active: { id: raised.blocker.id, resolvedAt: null },
        });
      }),
    ),
  );

  it.scoped("resolves a Task-backed blocker and returns its linked Task to Implementing", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const created = yield* tasks.createTask({
          title: "Resolve blocker",
          description: "Resume implementation with approved intent.",
          now: "2026-07-17T23:02:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T23:03:00.000Z" });
        const started = yield* starts.create({
          id: "change-resolve-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-resolve-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-resolve-blocker"),
          taskId,
          now: "2026-07-17T23:04:00.000Z",
        });
        if (!started.ok) return;
        const raised = yield* changes.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for approved intent.",
          now: "2026-07-17T23:05:00.000Z",
        });
        if (!raised.ok) return;

        const resolved = yield* changes.resolveImplementationBlocker({
          changeId: started.change.id,
          content: "Use the approved approach.",
          now: "2026-07-17T23:06:00.000Z",
        });

        expect(resolved).toMatchObject({
          ok: true,
          change: {
            state: "open",
            activeBlocker: null,
            acceptanceContext: { resolutions: ["Use the approved approach."] },
          },
          blocker: {
            id: raised.blocker.id,
            resolvedAt: "2026-07-17T23:06:00.000Z",
            resolution: { content: "Use the approved approach." },
          },
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "implementing" });
        expect(yield* changes.listImplementationBlockers(started.change.id)).toMatchObject({
          active: null,
          resolutions: [{ content: "Use the approved approach." }],
        });
      }),
    ),
  );

  it.scoped("atomically completes a merged Task-backed Change", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const created = yield* tasks.createTask({
          title: "Complete merged Change",
          description: "Complete the Change and linked Task together.",
          now: "2026-07-17T22:55:00.000Z",
        });
        if (!created.ok) return;
        const taskId = storedPublicTaskId(created.task.id);
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:56:00.000Z" });
        const started = yield* starts.create({
          id: "change-complete",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1"),
          taskId,
          now: "2026-07-17T22:57:00.000Z",
        });
        if (!started.ok) return;

        const completed = yield* changes.completeMergedChange({
          changeId: started.change.id,
          now: "2026-07-17T22:58:00.000Z",
        });

        expect(completed).toMatchObject({
          ok: true,
          changed: true,
          change: { state: "closed", closeReason: "completed", cleanup: { state: "pending" } },
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "done" });
      }),
    ),
  );

  it.scoped("identifies a Candidate by its exact fetched Change Base target", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/by-8",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "d5fbe76f5565fa4d7de3ee3c48135fc595b26bea",
          headSha: "c0ebeaa730bcd666c7b927db2542ea6ea9d9575c",
          now: "2026-07-25T12:00:00.000Z",
        });
        expect(first).toMatchObject({ ok: true, reused: false });
        if (!first.ok) return;

        const advancedTarget = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/by-8",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "b32245d73e2c2aaf9ed9d46270720591a6f62946",
          headSha: "c0ebeaa730bcd666c7b927db2542ea6ea9d9575c",
          now: "2026-07-25T13:00:00.000Z",
        });
        expect(advancedTarget).toMatchObject({ ok: true, reused: false });
        if (!advancedTarget.ok) return;

        const exactRepeat = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/by-8",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "b32245d73e2c2aaf9ed9d46270720591a6f62946",
          headSha: "c0ebeaa730bcd666c7b927db2542ea6ea9d9575c",
          now: "2026-07-25T14:00:00.000Z",
        });

        expect(advancedTarget.candidateId).not.toBe(first.candidateId);
        expect(advancedTarget.reused).toBe(false);
        expect(exactRepeat).toEqual({
          ok: true,
          changeId: first.changeId,
          candidateId: advancedTarget.candidateId,
          reused: true,
        });
      }),
    ),
  );

  it.scoped("returns only exact passing publication evidence", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangePersistence();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T15:00:00.000Z",
        });
        if (!captured.ok) return;
        yield* repository.operation("install passing publication evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, state, outcome, created_at, updated_at
              ) VALUES (
                'run-1', ${captured.candidateId}, '{}', 'complete', 'passed',
                '2026-07-25T15:01:00.000Z', '2026-07-25T15:01:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = ${captured.candidateId},
                publication_validation_run_id = 'run-1',
                publication_owner = 'acme', publication_repo = 'repo',
                publication_base_branch = 'main', publication_remote_name = 'origin',
                publication_head_branch = 'feature', publication_expected_head_sha = 'head-sha',
                publication_pr_number = 42, publication_pr_url = 'https://github.test/pull/42'
              WHERE id = ${captured.changeId}
            `;
          }),
        );

        expect(yield* changes.getPassingPublicationEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: "run-1",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });

        yield* repository.operation(
          "invalidate publication evidence",
          (sql) => sql`UPDATE candidate_validation_runs SET outcome = 'blocked' WHERE id = 'run-1'`,
        );
        expect(yield* changes.getPassingPublicationEvidence(captured.changeId)).toBeUndefined();

        const other = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/other",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T15:02:00.000Z",
        });
        if (!other.ok) return;
        yield* repository.operation("install another Change publication evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, state, outcome, created_at, updated_at
              ) VALUES (
                'run-2', ${other.candidateId}, '{}', 'complete', 'passed',
                '2026-07-25T15:03:00.000Z', '2026-07-25T15:03:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = ${other.candidateId},
                publication_validation_run_id = 'run-2'
              WHERE id = ${captured.changeId}
            `;
          }),
        );
        expect(yield* changes.getPassingPublicationEvidence(captured.changeId)).toBeUndefined();
      }),
    ),
  );

  it.scoped("replaces only the exact pending publication marker atomically", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangePersistence();
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "first-head",
          now: "2026-07-25T15:10:00.000Z",
        });
        if (!first.ok) return;
        const target = {
          owner: "acme",
          repo: "repo",
          baseBranch: "main",
          remoteName: "origin",
        };
        const pending = {
          changeId: first.changeId,
          candidateId: first.candidateId,
          validationRunId: "run-first",
          target,
          headBranch: "feature",
          expectedHeadSha: "first-head",
          now: "2026-07-25T15:11:00.000Z",
        };
        expect(yield* changes.beginPublication(pending)).toMatchObject({ ok: true, created: true });
        const second = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "second-head",
          now: "2026-07-25T15:12:00.000Z",
        });
        if (!second.ok) return;
        const replacement = {
          ...pending,
          candidateId: second.candidateId,
          validationRunId: "run-second",
          expectedHeadSha: "second-head",
          now: "2026-07-25T15:13:00.000Z",
          expectedCurrentCandidateId: first.candidateId,
          expectedCurrentValidationRunId: "run-first",
          expectedCurrentHeadSha: "first-head",
          expectedCurrentHeadBranch: "feature",
          expectedCurrentTarget: target,
        };
        expect(yield* changes.replacePendingPublication(replacement)).toMatchObject({ ok: true });
        expect(
          yield* changes.replacePendingPublication({
            ...replacement,
            expectedCurrentCandidateId: first.candidateId,
          }),
        ).toEqual({ ok: false, code: "publication_state_conflict" });
        expect(yield* changes.getChangeById(first.changeId)).toMatchObject({
          publication: { candidateId: second.candidateId, expectedHeadSha: "second-head" },
        });
      }),
    ),
  );

  it.scoped("upgrades existing publication facts before appending history", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteCandidateCapturePersistence();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/legacy",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-legacy",
          headSha: "head-legacy",
          now: "2026-07-25T15:30:00.000Z",
        });
        if (!captured.ok) return;
        yield* repository.operation("install legacy publication facts", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE changes SET publication_candidate_id = ${captured.candidateId}, publication_validation_run_id = 'legacy-run', publication_owner = 'acme', publication_repo = 'repo', publication_base_branch = 'main', publication_remote_name = 'origin', publication_head_branch = 'legacy', publication_expected_head_sha = 'head-legacy', publication_pr_number = 7, publication_pr_url = 'https://github.test/pull/7' WHERE id = ${captured.changeId}`;
            yield* sql`DROP TABLE candidate_publications`;
            yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN (11, 12, 13)`;
            yield* sql`INSERT INTO implementation_decisions (id, change_id, recorded_at, content) VALUES ('legacy-decision', ${captured.changeId}, '2026-07-25T15:30:00.000Z', 'Legacy unstructured decision')`;
          }),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const upgraded = yield* openSqliteChangePersistence();
            expect(yield* upgraded.listImplementationDecisions(captured.changeId)).toMatchObject([
              { content: "Legacy unstructured decision", choice: "Legacy unstructured decision" },
            ]);
            expect(yield* upgraded.listCandidatePublications(captured.changeId)).toMatchObject([
              {
                candidateId: captured.candidateId,
                headSha: "head-legacy",
                pullRequest: { number: 7 },
              },
            ]);
            const nextCapture = yield* openSqliteCandidateCapturePersistence();
            const next = yield* nextCapture.commitCapture({
              repositoryCommonDirectory: input.commonDirectory,
              branchRef: "refs/heads/legacy",
              baseRef: "refs/remotes/origin/main",
              expectedChangeId: captured.changeId,
              changeBaseSha: "base-next",
              headSha: "head-next",
              now: "2026-07-25T15:31:00.000Z",
            });
            expect(next.ok).toBe(true);
            if (!next.ok) throw new Error(next.code);
            yield* repository.operation(
              "prepare revised publication after upgrade",
              (sql) => sql`
                UPDATE changes
                SET publication_candidate_id = ${next.candidateId},
                    publication_validation_run_id = 'next-run',
                    publication_owner = 'acme', publication_repo = 'repo',
                    publication_base_branch = 'main', publication_remote_name = 'origin',
                    publication_head_branch = 'legacy', publication_expected_head_sha = 'head-next',
                    publication_pr_number = NULL, publication_pr_url = NULL
                WHERE id = ${captured.changeId}
              `,
            );
            const nextPublication = {
              changeId: captured.changeId,
              candidateId: next.candidateId,
              validationRunId: "next-run",
              target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
              headBranch: "legacy",
              expectedHeadSha: "head-next",
              changeBaseSha: "base-next",
              now: "2026-07-25T15:32:00.000Z",
            };
            expect(yield* upgraded.beginPublication(nextPublication)).toMatchObject({ ok: true });
            expect(
              yield* upgraded.recordPublishedPullRequest({
                ...nextPublication,
                pullRequest: { number: 7, url: "https://github.test/pull/7" },
              }),
            ).toMatchObject({ ok: true });
            expect(yield* upgraded.listCandidatePublications(captured.changeId)).toMatchObject([
              { headSha: "head-legacy" },
              { headSha: "head-next", changeBaseSha: "base-next" },
            ]);
          }).pipe(
            Effect.provide(
              repositorySqlLayer({
                commonDirectory: input.commonDirectory,
                statePath: input.statePath,
              }),
            ),
          ),
        );
      }),
    ),
  );

  it.scoped("appends immutable Candidate Publication history for repeated heads", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangePersistence();
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/revision",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-1",
          headSha: "head-1",
          now: "2026-07-25T16:00:00.000Z",
        });
        if (!first.ok) return;
        const target = { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" };
        const publication = {
          changeId: first.changeId,
          candidateId: first.candidateId,
          validationRunId: "run-1",
          target,
          headBranch: "revision",
          expectedHeadSha: "head-1",
          changeBaseSha: "base-1",
          now: "2026-07-25T16:01:00.000Z",
        };
        expect(yield* changes.beginPublication(publication)).toMatchObject({ ok: true });
        expect(
          yield* changes.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.test/pull/42" },
          }),
        ).toMatchObject({ ok: true });
        const second = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/revision",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-2",
          headSha: "head-2",
          now: "2026-07-25T16:02:00.000Z",
        });
        if (!second.ok) return;
        expect(
          yield* changes.recordPublishedPullRequest({
            changeId: first.changeId,
            candidateId: second.candidateId,
            validationRunId: "run-2",
            target,
            headBranch: "revision",
            expectedHeadSha: "head-2",
            changeBaseSha: "base-2",
            previousExpectedHeadSha: "head-1",
            previousCandidateId: first.candidateId,
            previousValidationRunId: "run-1",
            pullRequest: { number: 42, url: "https://github.test/pull/42" },
            now: "2026-07-25T16:03:00.000Z",
          }),
        ).toMatchObject({ ok: true });
        expect(yield* changes.listCandidatePublications(first.changeId)).toMatchObject([
          { candidateId: first.candidateId, headSha: "head-1", pullRequest: { number: 42 } },
          { candidateId: second.candidateId, headSha: "head-2", pullRequest: { number: 42 } },
        ]);
      }),
    ),
  );

  it.scoped("rolls back the complete Candidate capture when its write fails", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteCandidateCapturePersistence();
        yield* repository.operation(
          "prepare failed Candidate capture",
          (sql) => sql`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, base_ref, task_id, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES (
              'change-1', ${input.commonDirectory}, 'refs/heads/feature', NULL, NULL,
              'open', NULL, '2026-07-17T23:00:00.000Z', '2026-07-17T23:00:00.000Z', NULL
            )
          `,
        );
        yield* repository.operation(
          "install Candidate capture failure",
          (sql) => sql`
            CREATE TRIGGER reject_candidate_capture
            BEFORE INSERT ON candidates
            BEGIN
              SELECT RAISE(ABORT, 'deliberate Candidate write failure');
            END
          `,
        );

        yield* capture
          .commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/feature",
            expectedChangeId: "change-1",
            baseRef: "refs/heads/main",
            changeBaseSha: "base",
            headSha: "head",
            now: "2026-07-17T23:01:00.000Z",
          })
          .pipe(Effect.flip);

        expect(yield* capture.getChangeById("change-1")).toMatchObject({ baseRef: null });
        const candidates = yield* repository.operation(
          "read failed Candidate capture",
          (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM candidates`,
        );
        expect(candidates).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.scoped("acquires migrated repository state through one scoped SQL service", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const migrations = yield* repositorySql.operation(
          "read repository migrations",
          (sql) => sql<{
            readonly migration_id: number;
            readonly name: string;
          }>`
            SELECT migration_id, name
            FROM effect_sql_migrations
            ORDER BY migration_id
          `,
        );
        const identities = yield* repositorySql.operation(
          "read repository identity",
          (sql) => sql<{
            readonly common_directory: string;
          }>`
            SELECT common_directory
            FROM shared_state_identity
            WHERE id = 1
          `,
        );

        const candidateColumns = yield* repositorySql.operation(
          "read Candidate baseline shape",
          (sql) => sql<{ readonly name: string }>`PRAGMA table_info(candidates)`,
        );
        const taskColumns = yield* repositorySql.operation(
          "read Task completion shape",
          (sql) => sql<{ readonly name: string }>`PRAGMA table_info(tasks)`,
        );
        const changeColumns = yield* repositorySql.operation(
          "read Change no-change shape",
          (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
        );

        expect(migrations).toEqual([
          { migration_id: 1, name: "baseline" },
          { migration_id: 2, name: "reviewer_sessions" },
          { migration_id: 3, name: "implementation_decisions" },
          { migration_id: 4, name: "implementation_blockers" },
          { migration_id: 5, name: "acceptance_context_versions" },
          { migration_id: 6, name: "reconcile_implementation_blocker_storage" },
          { migration_id: 7, name: "reviewer_sessions_per_producer" },
          { migration_id: 8, name: "recover_published_remote_branch_cleanup" },
          { migration_id: 9, name: "active_validation_runs" },
          { migration_id: 10, name: "validation_workspace_paths" },
          { migration_id: 11, name: "candidate_publications" },
          { migration_id: 12, name: "structured_implementation_decisions" },
          { migration_id: 13, name: "remove_no_change_completion" },
        ]);
        expect(identities).toEqual([{ common_directory: repositorySql.commonDirectory }]);
        expect(candidateColumns.map(({ name }) => name)).toEqual([
          "id",
          "change_id",
          "change_base_sha",
          "head_sha",
          "created_at",
        ]);
        expect(taskColumns.map(({ name }) => name)).not.toContain("completion_kind");
        expect(changeColumns.map(({ name }) => name)).not.toContain("no_change_candidate_id");
        expect(changeColumns.map(({ name }) => name)).not.toContain("no_change_validation_run_id");
      }),
    ),
  );

  it.effect("preserves supported merged Done records while removing legacy columns", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore supported merged Done records", (sql) =>
                Effect.gen(function* () {
                  yield* sql`ALTER TABLE tasks ADD COLUMN completion_kind TEXT`;
                  yield* sql`ALTER TABLE changes ADD COLUMN no_change_candidate_id TEXT`;
                  yield* sql`ALTER TABLE changes ADD COLUMN no_change_validation_run_id TEXT`;
                  yield* sql`
                    INSERT INTO tasks (
                      id, numeric_id, title, description, state, completion_kind, created_at, updated_at
                    ) VALUES (
                      'BY-1', 1, 'Merged Done Task', 'Must survive migration.',
                      'done', 'merged_pr', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, task_id, state, close_reason,
                      created_at, updated_at, closed_at
                    ) VALUES (
                      'change-supported-merged', ${directory}, 'refs/heads/supported-merged',
                      'BY-1', 'closed', 'completed', '2026-07-25T16:30:00.000Z',
                      '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 13`;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const tasks = yield* repository.operation(
                "read migrated supported Task",
                (sql) => sql<{ readonly state: string }>`SELECT state FROM tasks WHERE id = 'BY-1'`,
              );
              const changes = yield* repository.operation(
                "read migrated supported Change",
                (sql) =>
                  sql<{ readonly state: string; readonly close_reason: string }>`
                    SELECT state, close_reason FROM changes WHERE id = 'change-supported-merged'
                  `,
              );
              const taskColumns = yield* repository.operation(
                "read migrated Task columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(tasks)`,
              );
              const changeColumns = yield* repository.operation(
                "read migrated Change columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
              );
              expect(tasks).toEqual([{ state: "done" }]);
              expect(changes).toEqual([{ state: "closed", close_reason: "completed" }]);
              expect(taskColumns.map(({ name }) => name)).not.toContain("completion_kind");
              expect(changeColumns.map(({ name }) => name)).not.toContain("no_change_candidate_id");
              expect(changeColumns.map(({ name }) => name)).not.toContain(
                "no_change_validation_run_id",
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("stops migration with Task and Change facts for unsupported No-Change records", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore unsupported No-Change records", (sql) =>
                Effect.gen(function* () {
                  yield* sql`ALTER TABLE tasks ADD COLUMN completion_kind TEXT`;
                  yield* sql`ALTER TABLE changes ADD COLUMN no_change_candidate_id TEXT`;
                  yield* sql`ALTER TABLE changes ADD COLUMN no_change_validation_run_id TEXT`;
                  yield* sql`
                    INSERT INTO tasks (
                      id, numeric_id, title, description, state, completion_kind, created_at, updated_at
                    ) VALUES (
                      'BY-1', 1, 'Unsupported No-Change Task', 'Must stop migration.',
                      'done', 'no_change', '2026-07-25T17:00:00.000Z', '2026-07-25T17:00:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at,
                      no_change_candidate_id, no_change_validation_run_id
                    ) VALUES (
                      'change-unsupported-no-change', ${directory}, 'refs/heads/unsupported-no-change',
                      'BY-1', 'open', '2026-07-25T17:00:00.000Z', '2026-07-25T17:00:00.000Z',
                      'candidate-unsupported', 'run-unsupported'
                    )
                  `;
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 13`;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          const error = yield* Effect.scoped(
            RepositorySql.pipe(
              Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath })),
            ),
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryMigrationFailed);
          const migrationError = Array.from(
            Cause.defects(error.cause as Cause.Cause<unknown>),
          )[0] as {
            readonly cause?: unknown;
          };
          expect(String(migrationError.cause)).toContain("taskId=BY-1 taskState=done");
          expect(String(migrationError.cause)).toContain("changeId=change-unsupported-no-change");
          expect(String(migrationError.cause)).toContain("candidateId=candidate-unsupported");
          expect(String(migrationError.cause)).toContain("validationRunId=run-unsupported");
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("reports migration failures through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation(
                "drop migrated Task comments",
                (sql) => sql`DROP TABLE task_comments`,
              );
              yield* repository.operation(
                "replace Task comments with an incompatible view",
                (sql) => sql`CREATE VIEW task_comments AS SELECT 1 AS sequence`,
              );
              yield* repository.operation(
                "clear repository migration ledger",
                (sql) => sql`DELETE FROM effect_sql_migrations`,
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          const error = yield* Effect.scoped(
            RepositorySql.pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory: directory,
                  statePath,
                }),
              ),
            ),
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryMigrationFailed);
          expect(error).toMatchObject({
            _tag: "RepositoryMigrationFailed",
            statePath,
          });
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("reports unavailable repository state through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.scoped(
          RepositorySql.pipe(
            Effect.provide(
              repositorySqlLayer({
                commonDirectory: directory,
                statePath: directory,
              }),
            ),
          ),
        ).pipe(
          Effect.flip,
          Effect.map((error) => {
            expect(error).toBeInstanceOf(RepositoryStateUnavailable);
            expect(error).toMatchObject({
              _tag: "RepositoryStateUnavailable",
              statePath: directory,
            });
            return error;
          }),
        ),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.scoped("keeps domain rejections successful and rolls back failed operations", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        yield* repositorySql.operation(
          "create transaction probe",
          (sql) => sql`
            CREATE TABLE transaction_probe (value TEXT NOT NULL)
          `,
        );

        const rejection = { ok: false as const, code: "identity_conflict" as const };
        const rejectionResult = yield* repositorySql.transaction("preserve domain rejection", () =>
          Effect.succeed(rejection),
        );

        expect(rejectionResult).toEqual(rejection);

        yield* repositorySql
          .transaction("roll back failed write", (sql) =>
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO transaction_probe (value) VALUES (${"rolled back"})
              `;
              return yield* new RepositoryPersistedDataInvalid({
                operationName: "decode transaction probe",
                cause: new Error("deliberate persisted-data failure"),
              });
            }),
          )
          .pipe(Effect.flip);

        const rows = yield* repositorySql.operation(
          "read transaction probe",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM transaction_probe
          `,
        );
        expect(rows).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.scoped("reports malformed persisted string arrays through the typed error channel", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const error = yield* repositorySql
          .decodeStringArray("read Finding files", '["file.ts",]')
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({
          _tag: "RepositoryPersistedDataInvalid",
          operationName: "read Finding files",
        });
      }),
    ),
  );

  it.scoped("reports SQL operation failures through the typed error channel", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repositorySql = yield* RepositorySql;
        const error = yield* repositorySql
          .operation("read missing storage", (sql) => sql`SELECT * FROM missing_table`)
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositorySqlOperationFailed);
        expect(error).toMatchObject({
          _tag: "RepositorySqlOperationFailed",
          operationName: "read missing storage",
        });
      }),
    ),
  );

  it.effect("reports a repository identity conflict through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) => {
        const statePath = join(directory, "state.sqlite");
        const acquire = (commonDirectory: string) =>
          Effect.scoped(
            RepositorySql.pipe(Effect.provide(repositorySqlLayer({ commonDirectory, statePath }))),
          );

        return Effect.gen(function* () {
          yield* acquire(join(directory, "first"));
          const error = yield* acquire(join(directory, "second")).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositoryIdentityConflict);
          expect(error).toMatchObject({
            _tag: "RepositoryIdentityConflict",
            expectedCommonDirectory: join(directory, "second"),
            actualCommonDirectory: join(directory, "first"),
          });
        });
      },
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.scoped("enforces the current Change lifecycle schema", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const error = yield* repository
          .operation(
            "insert invalid Change lifecycle state",
            (sql) => sql`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, task_id, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES (
              'invalid-change', '/repo/.git', 'refs/heads/invalid', NULL, 'invalid',
              NULL, '2026-07-22T10:00:00.000Z', '2026-07-22T10:00:00.000Z', NULL
            )
          `,
          )
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(RepositorySqlOperationFailed);
        const rows = yield* repository.operation(
          "count invalid Change rows",
          (sql) => sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM changes WHERE id = 'invalid-change'
          `,
        );
        expect(rows).toEqual([{ count: 0 }]);
      }),
    ),
  );

  it.effect("closes and reopens the same migrated repository state", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) => {
        const config = {
          commonDirectory: directory,
          statePath: join(directory, "state.sqlite"),
        };
        const readMigrationCount = Effect.scoped(
          migrationCount.pipe(Effect.provide(repositorySqlLayer(config))),
        );

        return Effect.gen(function* () {
          expect(yield* readMigrationCount).toBe(13);
          expect(yield* readMigrationCount).toBe(13);
        });
      },
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );
});
