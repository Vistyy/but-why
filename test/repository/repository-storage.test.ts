import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { CurrentChangeEvidenceQuery } from "../../src/change/changePorts.js";
import {
  RepositoryIdentityConflict,
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
} from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { encodeSqliteCandidateValidationPolicy } from "../../src/sqlite/sqliteCandidateValidationPolicy.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { storedPublicTaskId } from "../../src/task/taskId.js";
import { repoRoot } from "../support/by-cli.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import { openSqliteChangeValidationTestDependencies } from "../support/changeValidationPorts.js";
import { observeUntil } from "../support/observe.js";
import {
  passTaskReviewFixture,
  withTemporaryRepositoryState as withTemporaryState,
} from "../support/repository.js";
import { startTestProcess } from "../support/testProcess.js";

const installPublicationIdentity = (
  changeId: string,
  candidateId: string,
  validationRunId: string,
  expectedHeadSha: string,
  now: string,
) =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    yield* repository.operation("install publication identity fixture", (sql) =>
      Effect.gen(function* () {
        yield* sql`
          INSERT OR IGNORE INTO candidates (
            id, change_id, change_base_sha, head_sha, created_at
          ) VALUES (
            ${candidateId}, ${changeId}, ${`${candidateId}-base`}, ${expectedHeadSha}, ${now}
          )
        `;
        yield* sql`
          INSERT INTO current_candidates (change_id, candidate_id)
          VALUES (${changeId}, ${candidateId})
          ON CONFLICT (change_id) DO UPDATE SET candidate_id = excluded.candidate_id
        `;
        yield* sql`
          INSERT OR IGNORE INTO candidate_validation_runs (
            id, candidate_id, policy_snapshot, implementation_decisions,
            latest_resolved_blocker_id, state, outcome, created_at, updated_at
          ) VALUES (
            ${validationRunId}, ${candidateId},
            '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
            'complete', 'passed', ${now}, ${now}
          )
        `;
      }),
    );
  });

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

const repositoryTables = Effect.gen(function* () {
  const repositorySql = yield* RepositorySql;
  const rows = yield* repositorySql.operation(
    "read repository table names",
    (sql) => sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `,
  );
  return rows.map((row) => row.name);
});

const simplifiedReviewPolicy = {
  checks: [],
  copyFiles: [],
  specialistReviews: [
    {
      id: "standards",
      instructions: "Review standards.",
      instructionsSource: "repo",
      profile: {
        agentProfile: "standards",
        scope: "repo",
        profile: {
          agentRuntime: "pi",
          runtimeConfig: { model: "standards-model" },
        },
      },
    },
  ],
} as const;

const repairedAcceptancePolicy = {
  checks: [],
  copyFiles: [],
  specialistReviews: [],
  acceptanceReview: {
    instructions: "Review against the accepted intent.",
    instructionsSource: "built_in" as const,
    profile: {
      agentProfile: "acceptance",
      scope: "global" as const,
      profile: {
        agentRuntime: "pi" as const,
        runtimeConfig: { model: "acceptance-model" },
      },
    },
  },
} as const;

describe("repository SQL storage", () => {
  it.scoped("persists, replaces, and clears Repository Preparation failure", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const task = yield* tasks.createTask({
          title: "Persist exact accepted intent",
          description: "Capture this approved Task description.",
          now: "2026-07-17T22:48:00.000Z",
        });
        if (!task.ok) throw new Error(`Task creation failed: ${task.code}`);
        const taskId = storedPublicTaskId(task.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:49:00.000Z");

        const starts = yield* openSqliteChangeStartPersistence();
        const created = yield* starts.create({
          id: "change-preparation-outcome",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/change-preparation-outcome",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "change-preparation-outcome"),
          taskId,
          prepare: { command: "prepare repository", timeoutSeconds: 17 },
          now: "2026-07-17T22:50:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!created.ok) throw new Error(`Change Start failed: ${created.code}`);
        expect(yield* starts.getById(created.change.id)).toMatchObject({
          taskId,
          acceptanceContext: {
            version: 1,
            title: "Persist exact accepted intent",
            description: "Capture this approved Task description.",
          },
        });

        const firstFailure = {
          command: "prepare repository",
          exitCode: 7,
          timedOut: false,
          stdout: "partial",
          stderr: "failed",
        };
        yield* starts.recordPrepareOutcome(
          created.change.id,
          firstFailure,
          "2026-07-17T22:51:00.000Z",
        );
        expect(yield* starts.getById(created.change.id)).toMatchObject({
          id: created.change.id,
          prepareFailure: firstFailure,
        });

        const retryFailure = {
          ...firstFailure,
          exitCode: 124,
          timedOut: true,
          stderr: "timed out",
        };
        yield* starts.recordPrepareOutcome(
          created.change.id,
          retryFailure,
          "2026-07-17T22:52:00.000Z",
        );
        expect(yield* starts.getById(created.change.id)).toMatchObject({
          id: created.change.id,
          prepareFailure: retryFailure,
        });

        yield* starts.recordPrepareOutcome(created.change.id, null, "2026-07-17T22:53:00.000Z");
        expect(yield* starts.getById(created.change.id)).toMatchObject({
          id: created.change.id,
          prepareFailure: null,
        });
      }),
    ),
  );

  it.scoped("raises a Blocker without writing blocked Change or Task lifecycle state", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Raise blocker without lifecycle writes",
          description: "One unresolved row must be the active Blocker authority.",
          now: "2026-07-17T22:53:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:54:00.000Z");
        const started = yield* starts.create({
          id: "change-raise-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-raise-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-raise-blocker"),
          taskId,
          now: "2026-07-17T22:55:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);

        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for approved intent.",
          now: "2026-07-17T22:56:00.000Z",
        });

        expect(raised).toMatchObject({
          ok: true,
          blocker: { content: "Wait for approved intent.", resolvedAt: null },
        });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: { content: "Wait for approved intent.", resolvedAt: null },
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });
        expect(
          yield* changes.authority.listImplementationBlockers(started.change.id),
        ).toMatchObject({
          blockers: [{ content: "Wait for approved intent.", resolvedAt: null }],
          resolutions: [],
          active: { content: "Wait for approved intent.", resolvedAt: null },
        });
      }),
    ),
  );

  it.scoped("rejects a duplicate Blocker while one is unresolved", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Reject duplicate blocker",
          description: "One unresolved Implementation Blocker may exist for an open Change.",
          now: "2026-07-17T22:53:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:54:00.000Z");
        const started = yield* starts.create({
          id: "change-duplicate-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-duplicate-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-duplicate-blocker"),
          taskId,
          now: "2026-07-17T22:55:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const first = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for approved intent.",
          now: "2026-07-17T22:56:00.000Z",
        });
        if (!first.ok) throw new Error(`Blocker creation failed: ${first.code}`);

        const duplicate = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "A second blocker must not be recorded.",
          now: "2026-07-17T22:57:00.000Z",
        });

        expect(duplicate).toEqual({ ok: false, code: "change_blocked" });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: { id: first.blocker.id, resolvedAt: null },
        });
        expect(
          yield* changes.authority.listImplementationBlockers(started.change.id),
        ).toMatchObject({
          blockers: [{ id: first.blocker.id }],
          active: { id: first.blocker.id, resolvedAt: null },
        });
      }),
    ),
  );

  it.scoped("raises a Blocker after publication or a passing Candidate", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Raise after publication",
          description: "Publication and earlier passing evidence must not prevent a Blocker.",
          now: "2026-07-17T22:53:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:54:00.000Z");
        const started = yield* starts.create({
          id: "change-published-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-published-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-published-blocker"),
          taskId,
          now: "2026-07-17T22:55:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);

        const repository = yield* RepositorySql;
        yield* repository.operation("install published passing Candidate evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
              VALUES ('candidate-published', ${started.change.id}, 'base-sha', 'head-sha', '2026-07-17T22:56:00.000Z')
            `;
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, state, outcome, created_at, updated_at
              ) VALUES (
                'run-published', 'candidate-published', '{}', 'complete', 'passed',
                '2026-07-17T22:56:01.000Z', '2026-07-17T22:56:01.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = 'candidate-published',
                publication_validation_run_id = 'run-published',
                publication_owner = 'acme', publication_repo = 'repo',
                publication_base_branch = 'main', publication_remote_name = 'origin',
                publication_head_branch = 'published-blocker',
                publication_expected_head_sha = 'head-sha',
                publication_pr_number = 42, publication_pr_url = 'https://github.test/pull/42'
              WHERE id = ${started.change.id}
            `;
          }),
        );

        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "The published Candidate still needs an external decision.",
          now: "2026-07-17T22:57:00.000Z",
        });

        expect(raised).toMatchObject({
          ok: true,
          blocker: { resolvedAt: null },
        });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: { resolvedAt: null },
        });
        expect(
          yield* changes.authority.listImplementationBlockers(started.change.id),
        ).toMatchObject({
          blockers: [{ content: "The published Candidate still needs an external decision." }],
          active: { content: "The published Candidate still needs an external decision." },
        });
      }),
    ),
  );

  it.scoped("resolves a blocker and derives current Acceptance Context", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Resolve blocker",
          description: "Resume implementation with approved intent.",
          now: "2026-07-17T23:02:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T23:03:00.000Z");
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
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for approved intent.",
          now: "2026-07-17T23:05:00.000Z",
        });
        if (!raised.ok) throw new Error(`Blocker creation failed: ${raised.code}`);

        const resolved = yield* changes.authority.resolveImplementationBlocker({
          changeId: started.change.id,
          content: "Use the approved approach.",
          now: "2026-07-17T23:06:00.000Z",
        });

        expect(resolved).toMatchObject({
          ok: true,
          blocker: {
            id: raised.blocker.id,
            resolvedAt: "2026-07-17T23:06:00.000Z",
            resolution: { content: "Use the approved approach." },
          },
        });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: null,
          acceptanceContext: { resolutions: ["Use the approved approach."] },
        });
        const storedContext = yield* repository.operation(
          "read initial Acceptance Context",
          (sql) =>
            sql<{ readonly acceptanceContext: string | null }>`
            SELECT acceptance_context AS acceptanceContext
            FROM changes
            WHERE id = ${started.change.id}
          `,
        );
        expect(storedContext).toEqual([
          {
            acceptanceContext: JSON.stringify({
              version: 1,
              title: "Resolve blocker",
              description: "Resume implementation with approved intent.",
            }),
          },
        ]);
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });
        expect(
          yield* changes.authority.listImplementationBlockers(started.change.id),
        ).toMatchObject({
          active: null,
          resolutions: [{ content: "Use the approved approach." }],
        });
      }),
    ),
  );

  it.scoped("resolves a blocker for a Change without a Task", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const started = yield* starts.create({
          id: "change-without-task-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-change-without-task-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(
            input.commonDirectory,
            "worktrees",
            "by-1-change-without-task-blocker",
          ),
          now: "2026-07-17T23:02:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for an operator decision.",
          now: "2026-07-17T23:03:00.000Z",
        });
        if (!raised.ok) throw new Error(`Blocker creation failed: ${raised.code}`);

        const resolved = yield* changes.authority.resolveImplementationBlocker({
          changeId: started.change.id,
          content: "Continue without accepted intent.",
          now: "2026-07-17T23:04:00.000Z",
        });

        expect(resolved).toMatchObject({
          ok: true,
          blocker: { resolution: { content: "Continue without accepted intent." } },
        });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: null,
          acceptanceContext: null,
        });
        expect(
          yield* changes.authority.listImplementationBlockers(started.change.id),
        ).toMatchObject({
          active: null,
          resolutions: [{ content: "Continue without accepted intent." }],
        });
      }),
    ),
  );

  it.scoped("rejects a Resolution when no Blocker is active", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const started = yield* starts.create({
          id: "change-no-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-no-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-no-blocker"),
          now: "2026-07-17T23:02:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);

        const result = yield* changes.authority.resolveImplementationBlocker({
          changeId: started.change.id,
          content: "There is nothing to resolve.",
          now: "2026-07-17T23:03:00.000Z",
        });

        expect(result).toEqual({ ok: false, code: "no_active_blocker" });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
          activeBlocker: null,
        });
      }),
    ),
  );

  it.scoped(
    "rolls back the Change close when the linked Task cancellation fails in one transaction",
    () =>
      withTemporaryState((input) =>
        Effect.gen(function* () {
          const tasks = yield* openSqliteTaskPersistence("BY");
          const starts = yield* openSqliteChangeStartPersistence();
          const changes = yield* openSqliteChangeTestDependencies();
          const created = yield* tasks.createTask({
            title: "Cancel Change linked to a Task atomically",
            description: "The linked Task mutation and Change close share one transaction.",
            now: "2026-07-17T22:55:00.000Z",
          });
          if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
          const taskId = storedPublicTaskId(created.task.id);
          yield* passTaskReviewFixture(taskId, "2026-07-17T22:56:00.000Z");
          const started = yield* starts.create({
            id: "change-cancel-atomic",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/but-why/by-cancel-atomic",
            baseRef: "main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "1111111111111111111111111111111111111111",
            worktreePath: join(input.commonDirectory, "worktrees", "by-cancel-atomic"),
            taskId,
            now: "2026-07-17T22:57:00.000Z",
            reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
          });
          if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);

          const repository = yield* RepositorySql;
          yield* repository.operation("inject linked Task cancellation failure", (sql) =>
            sql.unsafe(`
              CREATE TRIGGER fail_task_cancel
              BEFORE UPDATE OF state ON tasks
              WHEN NEW.state = 'cancelled'
              BEGIN
                SELECT RAISE(ABORT, 'injected Task cancellation failure');
              END
            `),
          );

          const error = yield* changes.delivery
            .cancelChange({
              changeId: started.change.id,
              reason: "Scope removed",
              now: "2026-07-17T22:58:00.000Z",
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(RepositorySqlOperationFailed);
          expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
            state: "open",
            closeReason: null,
            cancelReason: null,
          });
          expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });
        }),
      ),
  );

  it.scoped("preserves an open Change when observed merge evidence is stale", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Stale merge evidence",
          description: "Observed facts must match current publication.",
          now: "2026-07-17T22:55:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:56:00.000Z");
        const started = yield* starts.create({
          id: "change-stale-evidence",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-stale",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-stale"),
          taskId,
          now: "2026-07-17T22:57:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const publication = {
          changeId: started.change.id,
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          target: {
            owner: "acme",
            repo: "widgets",
            baseBranch: "main",
            remoteName: "origin",
          },
          headBranch: "but-why/by-stale",
          expectedHeadSha: "expected-head",
          changeBaseSha: "base",
          now: "2026-07-17T22:57:30.000Z",
        };
        yield* installPublicationIdentity(
          publication.changeId,
          publication.candidateId,
          publication.validationRunId,
          publication.expectedHeadSha,
          publication.now,
        );
        const begun = yield* changes.publication.beginPublication(publication);
        if (!begun.ok) throw new Error(begun.code);
        const recorded = yield* changes.publication.recordPublishedPullRequest({
          ...publication,
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        });
        if (!recorded.ok) throw new Error(recorded.code);

        const exact = {
          repository: { owner: "acme", repo: "widgets" },
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          baseBranch: "main",
          headBranch: "but-why/by-stale",
          mergedHeadSha: "expected-head",
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          expectedHeadSha: "expected-head",
        };
        const staleVariants = [
          { ...exact, repository: { owner: "other", repo: "widgets" } },
          { ...exact, repository: { owner: "acme", repo: "other-repo" } },
          { ...exact, pullRequest: { number: 43, url: "https://github.com/acme/widgets/pull/43" } },
          { ...exact, baseBranch: "release" },
          { ...exact, headBranch: "other-branch" },
          { ...exact, mergedHeadSha: "merged-elsewhere" },
          { ...exact, candidateId: "candidate-2" },
          { ...exact, validationRunId: "validation-run-2" },
          { ...exact, expectedHeadSha: "other-head" },
        ] as const;

        for (const observed of staleVariants) {
          const result = yield* changes.delivery.completeMergedChange({
            changeId: started.change.id,
            now: "2026-07-17T22:58:00.000Z",
            observed,
          });
          expect(result).toEqual({ ok: false, code: "publication_mismatch" });
        }
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });

        const completed = yield* changes.delivery.completeMergedChange({
          changeId: started.change.id,
          now: "2026-07-17T22:59:00.000Z",
          observed: exact,
        });
        expect(completed).toMatchObject({
          ok: true,
          changed: true,
          change: { state: "closed" },
        });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "closed",
          closeReason: "completed",
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "done" });
      }),
    ),
  );

  it.scoped("rejects an older merged Candidate after a newer publication", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Newer publication wins",
          description: "Only the current publication can complete.",
          now: "2026-07-17T22:55:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:56:00.000Z");
        const started = yield* starts.create({
          id: "change-newer-publication",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-newer",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-newer"),
          taskId,
          now: "2026-07-17T22:57:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const target = {
          owner: "acme",
          repo: "widgets",
          baseBranch: "main",
          remoteName: "origin",
        };
        const first = {
          changeId: started.change.id,
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          target,
          headBranch: "but-why/by-newer",
          expectedHeadSha: "first-head",
          changeBaseSha: "base",
          now: "2026-07-17T22:57:30.000Z",
        };
        yield* installPublicationIdentity(
          first.changeId,
          first.candidateId,
          first.validationRunId,
          first.expectedHeadSha,
          first.now,
        );
        if (!(yield* changes.publication.beginPublication(first)).ok)
          throw new Error("begin failed");
        if (
          !(yield* changes.publication.recordPublishedPullRequest({
            ...first,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          })).ok
        )
          throw new Error("record failed");
        const newer = {
          ...first,
          candidateId: "candidate-2",
          validationRunId: "validation-run-2",
          expectedHeadSha: "second-head",
          now: "2026-07-17T22:59:00.000Z",
        };
        yield* installPublicationIdentity(
          newer.changeId,
          newer.candidateId,
          newer.validationRunId,
          newer.expectedHeadSha,
          newer.now,
        );
        const replaced = yield* changes.publication.recordPublishedPullRequest({
          ...newer,
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          previousExpectedHeadSha: first.expectedHeadSha,
          previousCandidateId: first.candidateId,
          previousValidationRunId: first.validationRunId,
          previousPullRequestNumber: 42,
        });
        if (!replaced.ok) throw new Error(replaced.code);

        const olderEvidence = {
          repository: { owner: "acme", repo: "widgets" },
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          baseBranch: "main",
          headBranch: "but-why/by-newer",
          mergedHeadSha: first.expectedHeadSha,
          candidateId: first.candidateId,
          validationRunId: first.validationRunId,
          expectedHeadSha: first.expectedHeadSha,
        };
        expect(
          yield* changes.delivery.completeMergedChange({
            changeId: started.change.id,
            now: "2026-07-17T23:00:00.000Z",
            observed: olderEvidence,
          }),
        ).toEqual({ ok: false, code: "publication_mismatch" });
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });

        const newerEvidence = {
          ...olderEvidence,
          mergedHeadSha: newer.expectedHeadSha,
          candidateId: newer.candidateId,
          validationRunId: newer.validationRunId,
          expectedHeadSha: newer.expectedHeadSha,
        };
        expect(
          yield* changes.delivery.completeMergedChange({
            changeId: started.change.id,
            now: "2026-07-17T23:01:00.000Z",
            observed: newerEvidence,
          }),
        ).toMatchObject({ ok: true, changed: true });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "done" });
      }),
    ),
  );

  it.scoped("rolls back terminal completion when the linked Task transition fails", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const created = yield* tasks.createTask({
          title: "Atomic terminal completion",
          description: "Change and Task terminal writes commit together.",
          now: "2026-07-17T22:55:00.000Z",
        });
        if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
        const taskId = storedPublicTaskId(created.task.id);
        yield* passTaskReviewFixture(taskId, "2026-07-17T22:56:00.000Z");
        const started = yield* starts.create({
          id: "change-atomic-completion",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-atomic",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-atomic"),
          taskId,
          now: "2026-07-17T22:57:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const publication = {
          changeId: started.change.id,
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          target: {
            owner: "acme",
            repo: "widgets",
            baseBranch: "main",
            remoteName: "origin",
          },
          headBranch: "but-why/by-atomic",
          expectedHeadSha: "expected-head",
          changeBaseSha: "base",
          now: "2026-07-17T22:57:30.000Z",
        };
        yield* installPublicationIdentity(
          publication.changeId,
          publication.candidateId,
          publication.validationRunId,
          publication.expectedHeadSha,
          publication.now,
        );
        if (!(yield* changes.publication.beginPublication(publication)).ok)
          throw new Error("begin failed");
        if (
          !(yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          })).ok
        )
          throw new Error("record failed");

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "install terminal Task completion failure",
          (sql) => sql`
            CREATE TRIGGER reject_terminal_task_completion
            BEFORE UPDATE OF state ON tasks
            WHEN NEW.state = 'done'
            BEGIN
              SELECT RAISE(ABORT, 'deliberate Task completion failure');
            END
          `,
        );

        yield* changes.delivery
          .completeMergedChange({
            changeId: started.change.id,
            now: "2026-07-17T22:58:00.000Z",
            observed: {
              repository: { owner: "acme", repo: "widgets" },
              pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
              baseBranch: "main",
              headBranch: "but-why/by-atomic",
              mergedHeadSha: "expected-head",
              candidateId: "candidate-1",
              validationRunId: "validation-run-1",
              expectedHeadSha: "expected-head",
            },
          })
          .pipe(Effect.flip);

        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "open",
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "todo" });
      }),
    ),
  );

  it.scoped("serializes concurrent terminal completions without repeating completion", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const started = yield* starts.create({
          id: "change-concurrent-completion",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-concurrent",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-concurrent"),
          now: "2026-07-17T22:57:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);
        const publication = {
          changeId: started.change.id,
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          target: {
            owner: "acme",
            repo: "widgets",
            baseBranch: "main",
            remoteName: "origin",
          },
          headBranch: "but-why/by-concurrent",
          expectedHeadSha: "expected-head",
          changeBaseSha: "base",
          now: "2026-07-17T22:57:30.000Z",
        };
        yield* installPublicationIdentity(
          publication.changeId,
          publication.candidateId,
          publication.validationRunId,
          publication.expectedHeadSha,
          publication.now,
        );
        if (!(yield* changes.publication.beginPublication(publication)).ok)
          throw new Error("begin failed");
        if (
          !(yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          })).ok
        )
          throw new Error("record failed");
        const evidence = {
          repository: { owner: "acme", repo: "widgets" },
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
          baseBranch: "main",
          headBranch: "but-why/by-concurrent",
          mergedHeadSha: "expected-head",
          candidateId: "candidate-1",
          validationRunId: "validation-run-1",
          expectedHeadSha: "expected-head",
        };

        const results = yield* Effect.all(
          [
            changes.delivery.completeMergedChange({
              changeId: started.change.id,
              now: "2026-07-17T22:58:00.000Z",
              observed: evidence,
            }),
            changes.delivery.completeMergedChange({
              changeId: started.change.id,
              now: "2026-07-17T22:58:00.000Z",
              observed: evidence,
            }),
          ],
          { concurrency: "unbounded" },
        );

        expect(
          results.filter((result) => result.ok === true && result.changed === true),
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.ok === true && result.changed === false),
        ).toHaveLength(1);
        expect(yield* changes.reads.getChangeById(started.change.id)).toMatchObject({
          state: "closed",
          closeReason: "completed",
          cleanup: { state: "pending" },
        });
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

  it.scoped("returns only exact complete passing publication evidence", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T15:00:00.000Z",
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
        const authority = {
          candidateId: captured.candidateId,
          validationRunId: "run-1",
          changeBaseSha: "base-sha",
        } satisfies CurrentChangeEvidenceQuery;
        yield* repository.operation("install passing publication evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'run-1', ${captured.candidateId},
                '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"standards","instructions":"Review standards.","instructionsSource":"repo","profile":{"agentProfile":"standards","scope":"repo","profile":{"agentRuntime":"pi","runtimeConfig":{"model":"standards-model"}}}}]}',
                '[]', NULL, 'complete', 'passed',
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

        const exactPublicationEvidence = {
          candidateId: captured.candidateId,
          validationRunId: "run-1",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        };
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toEqual(exactPublicationEvidence);

        yield* repository.operation("install repaired passed publication evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'run-repaired-publication', ${captured.candidateId},
                ${encodeSqliteCandidateValidationPolicy(repairedAcceptancePolicy)},
                '[]', NULL, 'complete', 'passed',
                '2026-07-25T15:01:30.000Z', '2026-07-25T15:01:30.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_validation_run_id = 'run-repaired-publication'
              WHERE id = ${captured.changeId}
            `;
          }),
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
            candidateId: captured.candidateId,
            validationRunId: "run-repaired-publication",
            changeBaseSha: "base-sha",
          }),
        ).toEqual({
          candidateId: captured.candidateId,
          validationRunId: "run-repaired-publication",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        yield* repository.operation(
          "restore publication evidence reference",
          (sql) =>
            sql`
              UPDATE changes SET publication_validation_run_id = 'run-1'
              WHERE id = ${captured.changeId}
            `,
        );

        yield* repository.operation(
          "invalidate publication evidence outcome",
          (sql) => sql`UPDATE candidate_validation_runs SET outcome = 'blocked' WHERE id = 'run-1'`,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toBeUndefined();
        yield* repository.operation(
          "restore publication evidence outcome",
          (sql) => sql`UPDATE candidate_validation_runs SET outcome = 'passed' WHERE id = 'run-1'`,
        );

        yield* repository.operation(
          "invalidate publication evidence state",
          (sql) =>
            sql`UPDATE candidate_validation_runs SET state = 'running', outcome = NULL WHERE id = 'run-1'`,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toBeUndefined();
        yield* repository.operation(
          "restore publication evidence state",
          (sql) =>
            sql`UPDATE candidate_validation_runs SET state = 'complete', outcome = 'passed' WHERE id = 'run-1'`,
        );

        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
            ...authority,
            changeBaseSha: "advanced-base",
          }),
        ).toBeUndefined();
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toEqual(exactPublicationEvidence);
        yield* repository.operation(
          "install duplicate-representation publication evidence",
          (sql) =>
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO candidate_validation_runs (
                  id, candidate_id, policy_snapshot, implementation_decisions,
                  latest_resolved_blocker_id, state, outcome, created_at, updated_at
                ) VALUES (
                  'run-duplicate-representation', ${captured.candidateId},
                  ${encodeSqliteCandidateValidationPolicy(repairedAcceptancePolicy)},
                  '[]', NULL, 'complete', 'passed',
                  '2026-07-25T15:01:30.000Z', '2026-07-25T15:01:30.000Z'
                )
              `;
              yield* sql`
                UPDATE changes SET
                  publication_validation_run_id = 'run-duplicate-representation'
                WHERE id = ${captured.changeId}
              `;
            }),
        );
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: "run-repaired-publication",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        yield* repository.operation(
          "restore publication evidence reference",
          (sql) =>
            sql`UPDATE changes SET publication_validation_run_id = 'run-1' WHERE id = ${captured.changeId}`,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toEqual(exactPublicationEvidence);
        const newerBaseCandidate = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          expectedChangeId: captured.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "advanced-base-sha",
          headSha: "head-sha",
          now: "2026-07-25T15:01:45.000Z",
        });
        if (!newerBaseCandidate.ok) throw new Error(newerBaseCandidate.code);
        expect(newerBaseCandidate.candidateId).not.toBe(captured.candidateId);
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId),
        ).toBeUndefined();
        expect(
          yield* changes.submission.getCompletedPublicationEvidence(
            captured.changeId,
            captured.candidateId,
            "run-1",
          ),
        ).toEqual(exactPublicationEvidence);

        yield* changes.authority.recordImplementationDecision({
          changeId: captured.changeId,
          choice: "Choose the passing path",
          rationale: "Prove that decisions remain Run provenance.",
          now: "2026-07-25T15:01:00.000Z",
        });
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toBeUndefined();

        const other = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/other",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T15:02:00.000Z",
        });
        if (!other.ok) throw new Error(`Candidate capture failed: ${other.code}`);
        yield* repository.operation("install another Change publication evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'run-2', ${other.candidateId},
                '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
                'complete', 'passed',
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
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toBeUndefined();
      }),
    ),
  );

  it.scoped("reuses a complete passing Validation Run by exact Candidate identity", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T16:10:00.000Z",
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
        const recordedDecision = yield* changes.authority.recordImplementationDecision({
          changeId: captured.changeId,
          choice: "Choose the passing path",
          rationale: "Prove that decisions remain Validation Run provenance.",
          now: "2026-07-25T16:10:00.000Z",
        });
        if (!recordedDecision.ok) throw new Error(recordedDecision.code);
        const policy = { checks: [], copyFiles: [], specialistReviews: [] };
        const exact = {
          candidateId: captured.candidateId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          policy,
          now: "2026-07-25T16:11:00.000Z",
        };
        const first = yield* validation.execution.startOrReuse(exact);
        if (first.reused || "blocked" in first || "active" in first)
          throw new Error("Expected a new Validation Run");
        expect(first.authority).toMatchObject({
          candidate: {
            id: captured.candidateId,
            changeId: captured.changeId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
          },
          policy,
          implementationDecisions: [recordedDecision.decision],
          blockerHistory: { active: null, blockers: [], resolutions: [] },
          latestResolvedBlockerId: null,
        });
        yield* validation.execution.complete({
          validationRunId: first.validationRunId,
          outcome: "passed",
          now: "2026-07-25T16:12:00.000Z",
        });

        expect(yield* validation.execution.startOrReuse(exact)).toMatchObject({
          reused: true,
          validationRunId: first.validationRunId,
        });

        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: first.validationRunId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });

        yield* repository.operation(
          "install duplicate-representation Validation Run evidence",
          (sql) =>
            sql`
                INSERT INTO candidate_validation_runs (
                  id, candidate_id, policy_snapshot, implementation_decisions,
                  latest_resolved_blocker_id, state, outcome, created_at, updated_at
                ) VALUES (
                  'run-duplicate-representation', ${captured.candidateId},
                  ${encodeSqliteCandidateValidationPolicy(simplifiedReviewPolicy)},
                  '[]', NULL, 'complete', 'passed',
                  '2026-07-25T16:12:30.000Z', '2026-07-25T16:12:30.000Z'
                )
              `,
        );
        const currentEvidence = {
          candidateId: captured.candidateId,
          validationRunId: "run-duplicate-representation",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        };
        yield* repository.operation(
          "install malformed older passing Run",
          (sql) =>
            sql`
                INSERT INTO candidate_validation_runs (
                  id, candidate_id, policy_snapshot, implementation_decisions,
                  latest_resolved_blocker_id, state, outcome, created_at, updated_at
                ) VALUES (
                  'run-older-malformed-passing', ${captured.candidateId}, 'malformed',
                  '[]', NULL, 'complete', 'passed',
                  '2026-07-25T16:10:00.000Z', '2026-07-25T16:10:00.000Z'
                )
              `,
        );
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual(
          currentEvidence,
        );
        yield* repository.operation(
          "remove malformed older passing Run",
          (sql) =>
            sql`DELETE FROM candidate_validation_runs WHERE id = 'run-older-malformed-passing'`,
        );
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual(
          currentEvidence,
        );
        expect(yield* validation.execution.startOrReuse(exact)).toMatchObject({
          reused: true,
          validationRunId: "run-duplicate-representation",
        });
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
            candidateId: captured.candidateId,
            validationRunId: "run-duplicate-representation",
            changeBaseSha: "base-sha",
          }),
        ).toEqual(currentEvidence);

        const policyMismatch = yield* validation.execution.startOrReuse({
          ...exact,
          policy: {
            checks: [{ id: "extra", command: "true", timeoutSeconds: 30 }],
            copyFiles: [],
            specialistReviews: [],
          },
        });
        expect(policyMismatch).toMatchObject({
          reused: true,
          validationRunId: "run-duplicate-representation",
        });

        const addedDecision = yield* changes.authority.recordImplementationDecision({
          changeId: captured.changeId,
          choice: "Add a second authority input",
          rationale: "A persisted decision remains separate Run provenance.",
          now: "2026-07-25T16:13:30.000Z",
        });
        if (!addedDecision.ok) throw new Error(addedDecision.code);
        const decisionsMismatch = yield* validation.execution.startOrReuse(exact);
        expect(decisionsMismatch).toMatchObject({
          reused: true,
          validationRunId: "run-duplicate-representation",
        });

        const identityError = yield* validation.execution
          .startOrReuse({ ...exact, headSha: "other-head" })
          .pipe(Effect.flip);
        expect(identityError).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Wait for an external decision.",
          now: "2026-07-25T16:15:00.000Z",
        });
        expect(raised.ok).toBe(true);
        const resolved = yield* changes.authority.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed without a Task intent.",
          now: "2026-07-25T16:16:00.000Z",
        });
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) throw new Error(resolved.code);
        const afterResolution = yield* validation.execution.startOrReuse({
          ...exact,
          now: "2026-07-25T16:17:00.000Z",
        });
        expect(afterResolution).toMatchObject({
          reused: true,
          validationRunId: "run-duplicate-representation",
        });
        if ("blocked" in afterResolution || "active" in afterResolution)
          throw new Error("Expected the passed Candidate judgment to be reused");
        expect(afterResolution.authority).toMatchObject({
          candidate: { id: captured.candidateId, changeId: captured.changeId },
          blockerHistory: {
            active: null,
            blockers: [{ id: resolved.blocker.id }],
            resolutions: [{ blockerId: resolved.blocker.id }],
          },
          latestResolvedBlockerId: resolved.blocker.id,
        });

        const secondRaised = yield* changes.authority.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Wait for a second external decision.",
          now: "2026-07-25T16:19:00.000Z",
        });
        if (!secondRaised.ok) throw new Error(secondRaised.code);
        const secondResolved = yield* changes.authority.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed after the second decision.",
          now: "2026-07-25T16:20:00.000Z",
        });
        if (!secondResolved.ok) throw new Error(secondResolved.code);
        const afterSecondResolution = yield* validation.execution.startOrReuse({
          ...exact,
          now: "2026-07-25T16:21:00.000Z",
        });
        expect(afterSecondResolution).toMatchObject({
          reused: true,
          validationRunId: "run-duplicate-representation",
        });
        const history = yield* validation.reads.listRunsForCandidate(captured.candidateId);
        expect(history.map((run) => run.id)).toContain(first.validationRunId);
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: "run-duplicate-representation",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
      }),
    ),
  );

  it.scoped("does not reuse Finding-blocked or tooling-failed Validation Runs", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/failed-validation",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T16:30:00.000Z",
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
        const start = (at: string) =>
          validation.execution.startOrReuse({
            candidateId: captured.candidateId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            policy: { checks: [], copyFiles: [], specialistReviews: [] },
            now: at,
          });

        const first = yield* start("2026-07-25T16:31:00.000Z");
        if (first.reused || "blocked" in first || "active" in first)
          throw new Error("Expected a new Validation Run");
        yield* validation.execution.complete({
          validationRunId: first.validationRunId,
          outcome: "passed",
          now: "2026-07-25T16:32:00.000Z",
        });
        expect(
          yield* validation.execution.startOrReuse({
            candidateId: captured.candidateId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            policy: { checks: [], copyFiles: [], specialistReviews: [] },
            now: "2026-07-25T16:32:30.000Z",
          }),
        ).toMatchObject({
          reused: true,
          validationRunId: first.validationRunId,
        });
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: first.validationRunId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        yield* repository.operation(
          "install later Finding-blocked Validation Run history",
          (sql) =>
            sql`
            INSERT INTO candidate_validation_runs (
              id, candidate_id, policy_snapshot, implementation_decisions,
              latest_resolved_blocker_id, state, outcome, created_at, updated_at
            ) VALUES (
              'run-later-blocked', ${captured.candidateId},
              '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
              'complete', 'blocked',
              '2026-07-25T16:33:00.000Z', '2026-07-25T16:33:00.000Z'
            )
          `,
        );
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: first.validationRunId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });

        const afterFinding = yield* start("2026-07-25T16:34:00.000Z");
        if (afterFinding.reused || "blocked" in afterFinding || "active" in afterFinding)
          throw new Error("Expected a new Validation Run after Findings");
        expect(afterFinding.validationRunId).not.toBe(first.validationRunId);
        yield* validation.execution.complete({
          validationRunId: afterFinding.validationRunId,
          outcome: "tooling_failed",
          now: "2026-07-25T16:34:00.000Z",
        });

        const afterTooling = yield* start("2026-07-25T16:35:00.000Z");
        if (afterTooling.reused || "blocked" in afterTooling || "active" in afterTooling)
          throw new Error("Expected a new Validation Run after tooling failure");
        expect(afterTooling.validationRunId).not.toBe(afterFinding.validationRunId);
        expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
          candidateId: captured.candidateId,
          validationRunId: first.validationRunId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
        });
        const history = yield* validation.reads.listRunsForCandidate(captured.candidateId);
        expect(history.map((run) => run.outcome)).toEqual([
          "passed",
          "blocked",
          "tooling_failed",
          null,
        ]);
      }),
    ),
  );

  it.scoped(
    "round-trips a current ordered Implementation Decision Snapshot through the real SQLite Adapter",
    () =>
      withTemporaryState((input) =>
        Effect.gen(function* () {
          const capture = yield* openSqliteCandidateCapturePersistence();
          const changes = yield* openSqliteChangeTestDependencies();
          const validation = yield* openSqliteChangeValidationTestDependencies();
          const captured = yield* capture.commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/feature",
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            now: "2026-07-25T17:00:00.000Z",
          });
          if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
          yield* changes.authority.recordImplementationDecision({
            changeId: captured.changeId,
            choice: "Keep rationale separate from intent",
            rationale: "Preserve rationale separately from approved intent.",
            now: "2026-07-25T17:01:00.000Z",
          });
          yield* changes.authority.recordImplementationDecision({
            changeId: captured.changeId,
            choice: "Use the current snapshot schema",
            rationale: "Reject retired content without rewriting stored rows.",
            now: "2026-07-25T17:02:00.000Z",
          });
          const decisions = yield* changes.authority.listImplementationDecisions(captured.changeId);
          const started = yield* validation.execution.startOrReuse({
            candidateId: captured.candidateId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            policy: { checks: [], copyFiles: [], specialistReviews: [] },
            now: "2026-07-25T17:03:00.000Z",
          });
          if (started.reused || "blocked" in started)
            throw new Error("Expected a new Validation Run");
          yield* validation.execution.complete({
            validationRunId: started.validationRunId,
            outcome: "passed",
            now: "2026-07-25T17:04:00.000Z",
          });

          const stored = yield* validation.reads.getRunById(started.validationRunId);
          expect(stored?.implementationDecisions).toEqual(decisions);
          const history = yield* validation.reads.listRunsForCandidate(captured.candidateId);
          expect(history[0]?.implementationDecisions).toEqual(decisions);
        }),
      ),
  );

  it.scoped(
    "rejects malformed or retired Implementation Decision Snapshots as RepositoryPersistedDataInvalid",
    () =>
      withTemporaryState((input) =>
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          const capture = yield* openSqliteCandidateCapturePersistence();
          const validation = yield* openSqliteChangeValidationTestDependencies();
          const captured = yield* capture.commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/feature",
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            now: "2026-07-25T17:10:00.000Z",
          });
          if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
          const malformedSnapshots = [
            { label: "malformed syntax", snapshot: "{not-json" },
            { label: "non-array container", snapshot: '{"id":"not-an-array"}' },
            { label: "string container", snapshot: '"not-an-array"' },
            {
              label: "missing field",
              snapshot:
                '[{"id":"decision-1","changeId":"change-1","sequence":1,"recordedAt":"2026-07-25T17:11:00.000Z","choice":"Missing rationale"}]',
            },
            {
              label: "wrong primitive type",
              snapshot:
                '[{"id":"decision-1","changeId":"change-1","sequence":"1","recordedAt":"2026-07-25T17:11:00.000Z","choice":"Sequence as text","rationale":"Wrong type."}]',
            },
            {
              label: "retired content representation",
              snapshot:
                '[{"id":"decision-1","changeId":"change-1","sequence":1,"recordedAt":"2026-07-25T17:11:00.000Z","content":"Legacy unstructured decision"}]',
            },
            {
              label: "unknown field",
              snapshot:
                '[{"id":"decision-1","changeId":"change-1","sequence":1,"recordedAt":"2026-07-25T17:11:00.000Z","choice":"Valid","rationale":"Valid.","extra":1}]',
            },
          ];
          yield* Effect.forEach(malformedSnapshots, ({ label, snapshot }, index) =>
            Effect.gen(function* () {
              const runId = `run-${index}`;
              yield* repository.operation(
                `install malformed Implementation Decision Snapshot: ${label}`,
                (sql) =>
                  sql`
                    INSERT INTO candidate_validation_runs (
                      id, candidate_id, policy_snapshot, implementation_decisions,
                      latest_resolved_blocker_id, state, outcome, created_at, updated_at
                    ) VALUES (
                      ${runId}, ${captured.candidateId},
                      '{"checks":[],"copyFiles":[],"specialistReviews":[]}',
                      ${snapshot}, NULL, 'complete', 'passed',
                      '2026-07-25T17:12:00.000Z', '2026-07-25T17:12:00.000Z'
                    )
                  `,
              );
              const runError = yield* validation.reads.getRunById(runId).pipe(Effect.flip);
              expect(runError).toBeInstanceOf(RepositoryPersistedDataInvalid);
              const listError = yield* validation.reads
                .listRunsForCandidate(captured.candidateId)
                .pipe(Effect.flip);
              expect(listError).toBeInstanceOf(RepositoryPersistedDataInvalid);
            }),
          );
        }),
      ),
  );

  it.scoped("rejects validation start-or-reuse for an unresolved Implementation Blocker", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-07-25T16:20:00.000Z",
        });
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Wait for an external decision.",
          now: "2026-07-25T16:21:00.000Z",
        });
        expect(raised.ok).toBe(true);

        const rejected = yield* validation.execution.startOrReuse({
          candidateId: captured.candidateId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          policy: { checks: [], copyFiles: [], specialistReviews: [] },
          now: "2026-07-25T16:22:00.000Z",
        });
        expect(rejected).toEqual({ reused: false, blocked: true });
        expect(yield* validation.active.getActiveForChange(captured.changeId)).toBeUndefined();

        const resolved = yield* changes.authority.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed with the accepted implementation.",
          now: "2026-07-25T16:23:00.000Z",
        });
        expect(resolved.ok).toBe(true);
        const admitted = yield* validation.execution.startOrReuse({
          candidateId: captured.candidateId,
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          policy: { checks: [], copyFiles: [], specialistReviews: [] },
          now: "2026-07-25T16:24:00.000Z",
        });
        expect(admitted.reused).toBe(false);
        expect("blocked" in admitted).toBe(false);
      }),
    ),
  );

  it.scoped("replaces only the exact pending publication marker atomically", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "first-head",
          now: "2026-07-25T15:10:00.000Z",
        });
        if (!first.ok) throw new Error(`Candidate capture failed: ${first.code}`);
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
        yield* installPublicationIdentity(
          pending.changeId,
          pending.candidateId,
          pending.validationRunId,
          pending.expectedHeadSha,
          pending.now,
        );
        expect(yield* changes.publication.beginPublication(pending)).toMatchObject({
          ok: true,
          created: true,
        });
        const second = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/feature",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "second-head",
          now: "2026-07-25T15:12:00.000Z",
        });
        if (!second.ok) throw new Error(`Candidate capture failed: ${second.code}`);
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
        yield* installPublicationIdentity(
          replacement.changeId,
          replacement.candidateId,
          replacement.validationRunId,
          replacement.expectedHeadSha,
          replacement.now,
        );
        expect(yield* changes.publication.replacePendingPublication(replacement)).toMatchObject({
          ok: true,
        });
        expect(
          yield* changes.publication.replacePendingPublication({
            ...replacement,
            expectedCurrentCandidateId: first.candidateId,
          }),
        ).toEqual({ ok: false, code: "publication_state_conflict" });
        expect(yield* changes.reads.getChangeById(first.changeId)).toMatchObject({
          publication: { candidateId: second.candidateId, expectedHeadSha: "second-head" },
        });
      }),
    ),
  );

  it.scoped("records the current publication facts without chronology", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const first = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/revision",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-1",
          headSha: "head-1",
          now: "2026-07-25T16:00:00.000Z",
        });
        if (!first.ok) throw new Error(`Candidate capture failed: ${first.code}`);
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
        yield* installPublicationIdentity(
          publication.changeId,
          publication.candidateId,
          publication.validationRunId,
          publication.expectedHeadSha,
          publication.now,
        );
        expect(yield* changes.publication.beginPublication(publication)).toMatchObject({
          ok: true,
        });
        expect(
          yield* changes.publication.recordPublishedPullRequest({
            ...publication,
            pullRequest: { number: 42, url: "https://github.test/pull/42" },
          }),
        ).toMatchObject({ ok: true });
        const second = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/revision",
          expectedChangeId: first.changeId,
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-2",
          headSha: "head-2",
          now: "2026-07-25T16:02:00.000Z",
        });
        if (!second.ok) throw new Error(`Candidate capture failed: ${second.code}`);
        yield* installPublicationIdentity(
          first.changeId,
          second.candidateId,
          "run-2",
          "head-2",
          "2026-07-25T16:03:00.000Z",
        );
        const recorded = yield* changes.publication.recordPublishedPullRequest({
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
          previousPullRequestNumber: 42,
          pullRequest: { number: 42, url: "https://github.test/pull/42" },
          now: "2026-07-25T16:03:00.000Z",
        });
        if (!recorded.ok) throw new Error(`Publication record failed: ${recorded.code}`);
        const revised = yield* changes.reads.getChangeById(first.changeId);
        expect(revised?.publication).toMatchObject({
          candidateId: second.candidateId,
          validationRunId: "run-2",
          expectedHeadSha: "head-2",
          pullRequest: { number: 42 },
        });
        const tables = yield* repositoryTables;
        expect(tables).not.toContain("candidate_publications");
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
              id, repository_common_directory, branch_ref, base_ref, state,
              close_reason, created_at, updated_at, closed_at
            ) VALUES (
              'change-1', ${input.commonDirectory}, 'refs/heads/feature', NULL,
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

  it.scoped("returns Reviewer Transcript references for the exact Change only", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const changes = yield* openSqliteChangeTestDependencies();
        yield* repository.operation("insert transcript Changes", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO changes (
                id, repository_common_directory, branch_ref, state,
                created_at, updated_at
              ) VALUES (
                'change-transcript-a', 'a', 'refs/heads/a',
                'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO changes (
                id, repository_common_directory, branch_ref, state,
                created_at, updated_at
              ) VALUES (
                'change-transcript-b', 'b', 'refs/heads/b',
                'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
              )
            `;
          }),
        );
        yield* repository.operation("seed legacy Reviewer Transcripts", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO reviewer_transcripts (change_id, producer, pi_session_id, file_path)
              VALUES
                ('change-transcript-a', 'acceptance', 'session-a-1', 'reviewer-sessions/review_session-a-1.jsonl'),
                ('change-transcript-a', 'standards', 'session-a-2', 'reviewer-sessions/review_session-a-2.jsonl'),
                ('change-transcript-b', 'acceptance', 'session-b-1', 'reviewer-sessions/review_session-b-1.jsonl')
            `;
          }),
        );

        const first =
          yield* changes.reviewerTranscripts.listReviewerTranscripts("change-transcript-a");
        const second =
          yield* changes.reviewerTranscripts.listReviewerTranscripts("change-transcript-b");

        expect(first).toEqual([
          {
            changeId: "change-transcript-a",
            producer: "acceptance",
            piSessionId: "session-a-1",
            filePath: "reviewer-sessions/review_session-a-1.jsonl",
          },
          {
            changeId: "change-transcript-a",
            producer: "standards",
            piSessionId: "session-a-2",
            filePath: "reviewer-sessions/review_session-a-2.jsonl",
          },
        ]);
        expect(second).toEqual([
          {
            changeId: "change-transcript-b",
            producer: "acceptance",
            piSessionId: "session-b-1",
            filePath: "reviewer-sessions/review_session-b-1.jsonl",
          },
        ]);
      }),
    ),
  );

  it.scoped("reads legacy Reviewer evidence without mutation", () =>
    withTemporaryState(() =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const changes = yield* openSqliteChangeTestDependencies();
        yield* repository.operation("insert transcript Change", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO changes (
                id, repository_common_directory, branch_ref, state,
                created_at, updated_at
              ) VALUES (
                'change-transcript-retained', 'retained', 'refs/heads/retained',
                'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
              )
            `;
          }),
        );
        yield* repository.operation("seed legacy Reviewer evidence", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO reviewer_sessions (change_id, producer, fingerprint, session_reference)
              VALUES ('change-transcript-retained', 'acceptance', 'fingerprint', 'session-live')
            `;
            yield* sql`
              INSERT INTO reviewer_transcripts (change_id, producer, pi_session_id, file_path)
              VALUES ('change-transcript-retained', 'acceptance', 'session-live', 'reviewer-sessions/review_session-live.jsonl')
            `;
          }),
        );

        const live = yield* changes.reviewerSessions.listReviewerSessions(
          "change-transcript-retained",
        );
        expect(live).toEqual([
          {
            ownerId: "change-transcript-retained",
            producer: "acceptance",
            fingerprint: "fingerprint",
            sessionReference: "session-live",
          },
        ]);
        const transcripts = yield* changes.reviewerTranscripts.listReviewerTranscripts(
          "change-transcript-retained",
        );
        expect(transcripts).toEqual([
          {
            changeId: "change-transcript-retained",
            producer: "acceptance",
            piSessionId: "session-live",
            filePath: "reviewer-sessions/review_session-live.jsonl",
          },
        ]);
      }),
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

  it.effect("reports a repository identity conflict through the typed error channel", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) => {
        const statePath = join(directory, "state.sqlite");
        const acquire = (commonDirectory: string, lifecycle?: "initialize") =>
          Effect.scoped(
            RepositorySql.pipe(
              Effect.provide(
                repositorySqlLayer({
                  commonDirectory,
                  statePath,
                  ...(lifecycle === undefined ? {} : { lifecycle }),
                }),
              ),
            ),
          );

        return Effect.gen(function* () {
          yield* acquire(join(directory, "first"), "initialize");
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

  it.effect("closes and reopens the same migrated repository state", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) => {
        const config = {
          commonDirectory: directory,
          statePath: join(directory, "state.sqlite"),
        };
        const initializeMigrationCount = Effect.scoped(
          migrationCount.pipe(
            Effect.provide(repositorySqlLayer({ ...config, lifecycle: "initialize" })),
          ),
        );
        return Effect.gen(function* () {
          expect(yield* initializeMigrationCount).toBe(42);
          const readMigrationCount = Effect.scoped(
            migrationCount.pipe(Effect.provide(repositorySqlLayer(config))),
          );
          expect(yield* readMigrationCount).toBe(42);
        });
      },
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  // Cross-process coordination evidence uses one real SQLite state path and real Node
  // processes because the serialization claim crosses process and SQLite boundaries.
  const helperTsxLoader = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
  const helperScript = join(repoRoot, "scripts/repository-process-helper.ts");

  const runHelperProcess = (
    args: readonly string[],
    cwd: string,
  ): Promise<{ readonly status: number | null; readonly stdout: string }> =>
    new Promise((resolveResult) => {
      const child = startTestProcess(
        process.execPath,
        ["--import", helperTsxLoader, helperScript, ...args],
        { cwd, timeout: 60_000 },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", (status) => resolveResult({ status, stdout: `${stdout}${stderr}`.trim() }));
    });

  const startMigrationLockHolder = (statePath: string, releasePath: string) => {
    const child = startTestProcess(
      process.execPath,
      ["--import", helperTsxLoader, helperScript, "hold-lock", statePath, releasePath],
      { cwd: dirname(statePath), timeout: 90_000 },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const done = new Promise<{ readonly status: number | null; readonly stdout: string }>(
      (resolveResult) => {
        child.on("close", (status) => resolveResult({ status, stdout: output.trim() }));
      },
    );
    return {
      child,
      done,
      get output() {
        return output;
      },
    };
  };

  const waitForMigrationLock = (holder: ReturnType<typeof startMigrationLockHolder>) =>
    observeUntil({
      description: "the lock holder to acquire the SQLite migration write lock",
      observe: () => holder.output,
      isReady: (value) => value.includes("locked"),
      timeoutMs: 15_000,
    });

  it.effect("produces complete state when separate processes start against one state path", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-concurrent-init-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const results = yield* Effect.promise(() =>
            Promise.all(
              ["ConcurrentA", "ConcurrentB", "ConcurrentC"].map((title) =>
                runHelperProcess(
                  ["open-state", statePath, directory, "5000", "30000", "50", title],
                  directory,
                ),
              ),
            ),
          );
          for (const result of results) {
            expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, found: true });
          }

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const migrations = yield* repository.operation(
                "read concurrent migration ledger",
                (sql) => sql<{ readonly migration_id: number; readonly name: string }>`
                    SELECT migration_id, name
                    FROM effect_sql_migrations
                    ORDER BY migration_id
                  `,
              );
              expect(migrations.length).toBe(42);
              expect(migrations.map((row) => row.migration_id)).toEqual(
                Array.from({ length: 42 }, (_, index) => index + 1),
              );
              const identities = yield* repository.operation(
                "read concurrent repository identity",
                (sql) => sql<{ readonly common_directory: string }>`
                    SELECT common_directory
                    FROM shared_state_identity
                    WHERE id = 1
                  `,
              );
              expect(identities).toEqual([{ common_directory: directory }]);

              const tasks = yield* openSqliteTaskPersistence("BY");
              const created = yield* tasks.createTask({
                title: "After concurrent initialization",
                description: "Read and write after concurrent startup.",
                now: "2026-07-17T22:46:00.000Z",
              });
              expect(created.ok).toBe(true);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("returns state_store_unavailable after a bounded wait while migration stays busy", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-migration-contention-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const releasePath = join(directory, "release-migration-lock");
          const holder = startMigrationLockHolder(statePath, releasePath);
          try {
            yield* Effect.promise(() => waitForMigrationLock(holder));

            const contended = yield* Effect.promise(() =>
              runHelperProcess(
                ["open-state", statePath, directory, "150", "400", "20", "Contended"],
                directory,
              ),
            );
            expect(contended.status).toBe(1);
            expect(JSON.parse(contended.stdout)).toMatchObject({
              ok: false,
              error: { _tag: "RepositoryStateUnavailable" },
            });

            writeFileSync(releasePath, "release\n");
            const released = yield* Effect.promise(() => holder.done);
            expect(released.status).toBe(0);
            expect(released.stdout).toContain("released");

            const recovered = yield* Effect.promise(() =>
              runHelperProcess(
                ["open-state", statePath, directory, "5000", "30000", "50", "Recovery"],
                directory,
              ),
            );
            expect(recovered.status).toBe(0);
            expect(JSON.parse(recovered.stdout)).toMatchObject({ ok: true, found: true });
          } finally {
            if (holder.child.exitCode === null) holder.child.kill("SIGTERM");
          }
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("opens an already-current Shared Repository State without migration coordination", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-current-open-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const primed = yield* Effect.promise(() =>
            runHelperProcess(
              ["open-state", statePath, directory, "5000", "30000", "50", "Prime"],
              directory,
            ),
          );
          expect(primed.status).toBe(0);
          expect(JSON.parse(primed.stdout)).toMatchObject({ ok: true, found: true });

          const releasePath = join(directory, "release-current-state-lock");
          const holder = startMigrationLockHolder(statePath, releasePath);
          try {
            yield* Effect.promise(() => waitForMigrationLock(holder));

            // The already-current open must succeed even with a short busy timeout
            // and contention deadline while another process holds the migration
            // write lock, because ordinary opens skip migration coordination.
            const reopened = yield* Effect.promise(() =>
              runHelperProcess(["open-read", statePath, directory, "150", "400", "20"], directory),
            );
            expect(reopened.status).toBe(0);
            expect(JSON.parse(reopened.stdout)).toMatchObject({
              ok: true,
              migrationCount: 42,
            });
            writeFileSync(releasePath, "release\n");
            const released = yield* Effect.promise(() => holder.done);
            expect(released.status).toBe(0);
          } finally {
            if (holder.child.exitCode === null) holder.child.kill("SIGTERM");
          }
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );
});
