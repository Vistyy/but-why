import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { describe } from "vitest";
import type { CurrentChangeEvidenceQuery } from "../../src/change/changePorts.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositoryRestoredTransientState,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
} from "../../src/contracts/repositoryStorageError.js";
import { baselineMigration } from "../../src/sqlite/migrations/0001_baseline.js";
import { reviewerSessionsMigration } from "../../src/sqlite/migrations/0002_reviewer_sessions.js";
import { implementationDecisionsMigration } from "../../src/sqlite/migrations/0003_implementation_decisions.js";
import { implementationBlockersMigration } from "../../src/sqlite/migrations/0004_implementation_blockers.js";
import { acceptanceContextVersionsMigration } from "../../src/sqlite/migrations/0005_acceptance_context_versions.js";
import { reconcileImplementationBlockerStorageMigration } from "../../src/sqlite/migrations/0006_reconcile_implementation_blocker_storage.js";
import { specialistReviewerSessionsMigration } from "../../src/sqlite/migrations/0007_reviewer_sessions_per_producer.js";
import { recoverPublishedRemoteBranchCleanupMigration } from "../../src/sqlite/migrations/0008_recover_published_remote_branch_cleanup.js";
import { activeValidationRunsMigration } from "../../src/sqlite/migrations/0009_active_validation_runs.js";
import { validationWorkspacePathsMigration } from "../../src/sqlite/migrations/0010_validation_workspace_paths.js";
import { candidatePublicationsMigration } from "../../src/sqlite/migrations/0011_candidate_publications.js";
import { structuredImplementationDecisionsMigration } from "../../src/sqlite/migrations/0012_structured_implementation_decisions.js";
import { removeNoChangeCompletionMigration } from "../../src/sqlite/migrations/0013_remove_no_change_completion.js";
import { removeChangeReadinessMigration } from "../../src/sqlite/migrations/0014_remove_change_readiness.js";
import { removeAcceptanceContextVersionsMigration } from "../../src/sqlite/migrations/0015_remove_acceptance_context_versions.js";
import { removeImplementationDecisionContentMigration } from "../../src/sqlite/migrations/0016_remove_implementation_decision_content.js";
import { validationRunBlockerIdentityMigration } from "../../src/sqlite/migrations/0017_validation_run_blocker_identity.js";
import { removeFindingSeverityMigration } from "../../src/sqlite/migrations/0018_remove_finding_severity.js";
import { simplifyReviewerSessionsMigration } from "../../src/sqlite/migrations/0019_simplify_reviewer_sessions.js";
import { removeCandidatePublicationsMigration } from "../../src/sqlite/migrations/0020_remove_candidate_publications.js";
import { reviewerTranscriptsMigration } from "../../src/sqlite/migrations/0021_reviewer_transcripts.js";
import { changeCancelReasonMigration } from "../../src/sqlite/migrations/0022_change_cancel_reason.js";
import { restrictLifecycleStatesMigration } from "../../src/sqlite/migrations/0023_restrict_lifecycle_states.js";
import { removeTaskCommentsMigration } from "../../src/sqlite/migrations/0024_remove_task_comments.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
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
import { withTemporaryRepositoryState as withTemporaryState } from "../support/repository.js";
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

const rollbackNativeSnapshotWorkspaceMigration = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      RENAME COLUMN expected_commit_sha TO submitted_sha
    `);
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      RENAME COLUMN workspace_path TO worktree_path
    `);
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      RENAME COLUMN cleanup_workspace TO cleanup_worktree
    `);
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      ADD COLUMN worktree_head TEXT NOT NULL DEFAULT ''
    `);
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      ADD COLUMN temp_ref_name TEXT NOT NULL DEFAULT ''
    `);
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      ADD COLUMN cleanup_temp_ref TEXT NOT NULL DEFAULT 'not_created'
    `);
    yield* sql.unsafe(`
      ALTER TABLE candidate_snapshot_workspaces
      RENAME TO candidate_validation_workspace_setups
    `);
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

const migrateThrough23 = Migrator.make({})({
  loader: Migrator.fromRecord({
    "0001_baseline": baselineMigration,
    "0002_reviewer_sessions": reviewerSessionsMigration,
    "0003_implementation_decisions": implementationDecisionsMigration,
    "0004_implementation_blockers": implementationBlockersMigration,
    "0005_acceptance_context_versions": acceptanceContextVersionsMigration,
    "0006_reconcile_implementation_blocker_storage": reconcileImplementationBlockerStorageMigration,
    "0007_reviewer_sessions_per_producer": specialistReviewerSessionsMigration,
    "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanupMigration,
    "0009_active_validation_runs": activeValidationRunsMigration,
    "0010_validation_workspace_paths": validationWorkspacePathsMigration,
    "0011_candidate_publications": candidatePublicationsMigration,
    "0012_structured_implementation_decisions": structuredImplementationDecisionsMigration,
    "0013_remove_no_change_completion": removeNoChangeCompletionMigration,
    "0014_remove_change_readiness": removeChangeReadinessMigration,
    "0015_remove_acceptance_context_versions": removeAcceptanceContextVersionsMigration,
    "0016_remove_implementation_decision_content": removeImplementationDecisionContentMigration,
    "0017_validation_run_blocker_identity": validationRunBlockerIdentityMigration,
    "0018_remove_finding_severity": removeFindingSeverityMigration,
    "0019_simplify_reviewer_sessions": simplifyReviewerSessionsMigration,
    "0020_remove_candidate_publications": removeCandidatePublicationsMigration,
    "0021_reviewer_transcripts": reviewerTranscriptsMigration,
    "0022_change_cancel_reason": changeCancelReasonMigration,
    "0023_restrict_lifecycle_states": restrictLifecycleStatesMigration,
  }),
});

const migrateThrough24 = Migrator.make({})({
  loader: Migrator.fromRecord({
    "0001_baseline": baselineMigration,
    "0002_reviewer_sessions": reviewerSessionsMigration,
    "0003_implementation_decisions": implementationDecisionsMigration,
    "0004_implementation_blockers": implementationBlockersMigration,
    "0005_acceptance_context_versions": acceptanceContextVersionsMigration,
    "0006_reconcile_implementation_blocker_storage": reconcileImplementationBlockerStorageMigration,
    "0007_reviewer_sessions_per_producer": specialistReviewerSessionsMigration,
    "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanupMigration,
    "0009_active_validation_runs": activeValidationRunsMigration,
    "0010_validation_workspace_paths": validationWorkspacePathsMigration,
    "0011_candidate_publications": candidatePublicationsMigration,
    "0012_structured_implementation_decisions": structuredImplementationDecisionsMigration,
    "0013_remove_no_change_completion": removeNoChangeCompletionMigration,
    "0014_remove_change_readiness": removeChangeReadinessMigration,
    "0015_remove_acceptance_context_versions": removeAcceptanceContextVersionsMigration,
    "0016_remove_implementation_decision_content": removeImplementationDecisionContentMigration,
    "0017_validation_run_blocker_identity": validationRunBlockerIdentityMigration,
    "0018_remove_finding_severity": removeFindingSeverityMigration,
    "0019_simplify_reviewer_sessions": simplifyReviewerSessionsMigration,
    "0020_remove_candidate_publications": removeCandidatePublicationsMigration,
    "0021_reviewer_transcripts": reviewerTranscriptsMigration,
    "0022_change_cancel_reason": changeCancelReasonMigration,
    "0023_restrict_lifecycle_states": restrictLifecycleStatesMigration,
    "0024_remove_task_comments": removeTaskCommentsMigration,
  }),
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

const migrateThrough22 = Migrator.make({})({
  loader: Migrator.fromRecord({
    "0001_baseline": baselineMigration,
    "0002_reviewer_sessions": reviewerSessionsMigration,
    "0003_implementation_decisions": implementationDecisionsMigration,
    "0004_implementation_blockers": implementationBlockersMigration,
    "0005_acceptance_context_versions": acceptanceContextVersionsMigration,
    "0006_reconcile_implementation_blocker_storage": reconcileImplementationBlockerStorageMigration,
    "0007_reviewer_sessions_per_producer": specialistReviewerSessionsMigration,
    "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanupMigration,
    "0009_active_validation_runs": activeValidationRunsMigration,
    "0010_validation_workspace_paths": validationWorkspacePathsMigration,
    "0011_candidate_publications": candidatePublicationsMigration,
    "0012_structured_implementation_decisions": structuredImplementationDecisionsMigration,
    "0013_remove_no_change_completion": removeNoChangeCompletionMigration,
    "0014_remove_change_readiness": removeChangeReadinessMigration,
    "0015_remove_acceptance_context_versions": removeAcceptanceContextVersionsMigration,
    "0016_remove_implementation_decision_content": removeImplementationDecisionContentMigration,
    "0017_validation_run_blocker_identity": validationRunBlockerIdentityMigration,
    "0018_remove_finding_severity": removeFindingSeverityMigration,
    "0019_simplify_reviewer_sessions": simplifyReviewerSessionsMigration,
    "0020_remove_candidate_publications": removeCandidatePublicationsMigration,
    "0021_reviewer_transcripts": reviewerTranscriptsMigration,
    "0022_change_cancel_reason": changeCancelReasonMigration,
  }),
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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:49:00.000Z" });

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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:54:00.000Z" });
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
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);

        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: started.change.id,
          content: "Wait for approved intent.",
          now: "2026-07-17T22:56:00.000Z",
        });

        expect(raised).toMatchObject({
          ok: true,
          change: {
            state: "open",
            activeBlocker: { content: "Wait for approved intent.", resolvedAt: null },
          },
          blocker: { content: "Wait for approved intent.", resolvedAt: null },
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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:54:00.000Z" });
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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:54:00.000Z" });
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
          change: { state: "open", activeBlocker: { resolvedAt: null } },
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

  it.scoped("resolves a Task-backed blocker and appends to current Acceptance Context", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
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

  it.scoped("resolves a taskless blocker without creating Acceptance Context", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const started = yield* starts.create({
          id: "change-taskless-blocker",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-taskless-blocker",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-taskless-blocker"),
          now: "2026-07-17T23:02:00.000Z",
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
          content: "Continue without taskless intent.",
          now: "2026-07-17T23:04:00.000Z",
        });

        expect(resolved).toMatchObject({
          ok: true,
          change: { state: "open", activeBlocker: null, acceptanceContext: null },
          blocker: { resolution: { content: "Continue without taskless intent." } },
        });
        expect(
          yield* changes.authority.listImplementationBlockers(started.change.id),
        ).toMatchObject({
          active: null,
          resolutions: [{ content: "Continue without taskless intent." }],
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
            title: "Cancel Task-backed Change atomically",
            description: "The linked Task mutation and Change close share one transaction.",
            now: "2026-07-17T22:55:00.000Z",
          });
          if (!created.ok) throw new Error(`Task creation failed: ${created.code}`);
          const taskId = storedPublicTaskId(created.task.id);
          yield* tasks.approveTask({ taskId, now: "2026-07-17T22:56:00.000Z" });
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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:56:00.000Z" });
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
          change: { state: "closed", closeReason: "completed" },
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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:56:00.000Z" });
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
        yield* tasks.approveTask({ taskId, now: "2026-07-17T22:56:00.000Z" });
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
          policy: simplifiedReviewPolicy,
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
            policy: repairedAcceptancePolicy,
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
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
            ...authority,
            policy: {
              checks: [{ id: "extra", command: "true", timeoutSeconds: 30 }],
              copyFiles: [],
              specialistReviews: [],
            },
          }),
        ).toBeUndefined();
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
                  '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"standards","instructions":"Review standards.","instructionsSource":"repo","agentProfile":"standards","profileScope":"repo","profile":{"agentProfile":"standards","scope":"repo","profile":{"agentRuntime":"pi","runtimeConfig":{"model":"standards-model"}}}}]}',
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
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId, authority),
        ).toEqual({
          candidateId: captured.candidateId,
          validationRunId: "run-1",
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
          rationale: "Prove that decisions are part of current evidence identity.",
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

  it.scoped(
    "reuses only an exact complete passing Validation Run across authority differences",
    () =>
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
            rationale: "Prove that decisions are part of Validation Run identity.",
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

          yield* repository.operation("install incomplete Task authority relationship", (sql) =>
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO tasks (
                  id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
                ) VALUES (
                  'BY-904', 904, 'Incomplete evidence authority',
                  'Require the Task Acceptance Context relationship.', 'todo', NULL,
                  '2026-07-25T16:12:00.000Z', '2026-07-25T16:12:00.000Z'
                )
              `;
              yield* sql`PRAGMA ignore_check_constraints = ON`;
              yield* sql`UPDATE changes SET task_id = 'BY-904' WHERE id = ${captured.changeId}`;
              yield* sql`PRAGMA ignore_check_constraints = OFF`;
            }),
          );
          const incompleteAuthorityError = yield* changes.authority
            .getCurrentPassingEvidence(captured.changeId)
            .pipe(Effect.flip);
          expect(incompleteAuthorityError).toBeInstanceOf(RepositoryPersistedDataInvalid);
          yield* repository.operation(
            "restore taskless evidence authority",
            (sql) => sql`UPDATE changes SET task_id = NULL WHERE id = ${captured.changeId}`,
          );

          yield* repository.operation(
            "corrupt Run authority outside a policy-mismatched query",
            (sql) =>
              sql`UPDATE candidate_validation_runs SET implementation_decisions = '{}'
                  WHERE id = ${first.validationRunId}`,
          );
          expect(
            yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
              policy: {
                checks: [{ id: "other", command: "true", timeoutSeconds: 30 }],
                copyFiles: [],
                specialistReviews: [],
              },
            }),
          ).toBeUndefined();
          yield* repository.operation(
            "restore Run authority after policy-mismatched query",
            (sql) =>
              sql`UPDATE candidate_validation_runs SET implementation_decisions = ${JSON.stringify([recordedDecision.decision])}
                  WHERE id = ${first.validationRunId}`,
          );

          yield* repository.operation(
            "corrupt Decision outside a base-mismatched query",
            (sql) =>
              sql`UPDATE implementation_decisions SET choice = x'01' WHERE id = ${recordedDecision.decision.id}`,
          );
          expect(
            yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
              changeBaseSha: "other-base",
            }),
          ).toBeUndefined();
          yield* repository.operation(
            "restore Decision after base-mismatched query",
            (sql) =>
              sql`UPDATE implementation_decisions SET choice = 'Choose the passing path' WHERE id = ${recordedDecision.decision.id}`,
          );

          yield* repository.operation(
            "install duplicate-representation Validation Run evidence",
            (sql) =>
              sql`
                INSERT INTO candidate_validation_runs (
                  id, candidate_id, policy_snapshot, implementation_decisions,
                  latest_resolved_blocker_id, state, outcome, created_at, updated_at
                ) VALUES (
                  'run-duplicate-representation', ${captured.candidateId},
                  '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"standards","instructions":"Review standards.","instructionsSource":"repo","agentProfile":"standards","profileScope":"repo","profile":{"agentProfile":"standards","scope":"repo","profile":{"agentRuntime":"pi","runtimeConfig":{"model":"standards-model"}}}}]}',
                  '[]', NULL, 'complete', 'passed',
                  '2026-07-25T16:12:30.000Z', '2026-07-25T16:12:30.000Z'
                )
              `,
          );
          const simplifiedCurrent = yield* validation.execution.startOrReuse({
            candidateId: captured.candidateId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            policy: simplifiedReviewPolicy,
            now: "2026-07-25T16:12:40.000Z",
          });
          yield* repository.operation(
            "remove unrelated malformed Validation Run fixture",
            (sql) =>
              sql`DELETE FROM candidate_validation_runs WHERE id = 'run-duplicate-representation'`,
          );
          if (simplifiedCurrent.reused || "blocked" in simplifiedCurrent)
            throw new Error("Expected a policy-distinct Validation Run");
          yield* validation.execution.complete({
            validationRunId: simplifiedCurrent.validationRunId,
            outcome: "passed",
            now: "2026-07-25T16:12:45.000Z",
          });
          yield* repository.operation(
            "make the current policy-distinct Run non-passing",
            (sql) =>
              sql`UPDATE candidate_validation_runs SET outcome = 'blocked' WHERE id = ${simplifiedCurrent.validationRunId}`,
          );
          const currentEvidence = {
            candidateId: captured.candidateId,
            validationRunId: first.validationRunId,
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
          yield* repository.operation(
            "make the later policy-distinct Run malformed and tooling-failed",
            (sql) =>
              sql`UPDATE candidate_validation_runs
                  SET outcome = 'tooling_failed', policy_snapshot = 'malformed'
                  WHERE id = ${simplifiedCurrent.validationRunId}`,
          );
          expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual(
            currentEvidence,
          );
          expect(yield* validation.execution.startOrReuse(exact)).toMatchObject({
            reused: true,
            validationRunId: first.validationRunId,
          });
          yield* repository.operation(
            "remove malformed ineligible Validation Run fixture",
            (sql) =>
              sql`DELETE FROM candidate_validation_runs WHERE id = ${simplifiedCurrent.validationRunId}`,
          );
          expect(
            yield* changes.authority.getCurrentPassingEvidence(captured.changeId, {
              candidateId: captured.candidateId,
              validationRunId: first.validationRunId,
              changeBaseSha: "base-sha",
              policy,
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
          expect(policyMismatch.reused).toBe(false);
          if (policyMismatch.reused || "blocked" in policyMismatch)
            throw new Error("Expected a policy-distinct Validation Run");
          yield* validation.execution.complete({
            validationRunId: policyMismatch.validationRunId,
            outcome: "passed",
            now: "2026-07-25T16:13:00.000Z",
          });

          const addedDecision = yield* changes.authority.recordImplementationDecision({
            changeId: captured.changeId,
            choice: "Add a second authority input",
            rationale: "A persisted decision requires fresh Validation evidence.",
            now: "2026-07-25T16:13:30.000Z",
          });
          if (!addedDecision.ok) throw new Error(addedDecision.code);
          const decisionsMismatch = yield* validation.execution.startOrReuse(exact);
          expect(decisionsMismatch.reused).toBe(false);
          if (decisionsMismatch.reused || "blocked" in decisionsMismatch)
            throw new Error("Expected a decision-distinct Validation Run");
          yield* validation.execution.complete({
            validationRunId: decisionsMismatch.validationRunId,
            outcome: "passed",
            now: "2026-07-25T16:14:00.000Z",
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
            content: "Proceed without taskless intent.",
            now: "2026-07-25T16:16:00.000Z",
          });
          expect(resolved.ok).toBe(true);
          if (!resolved.ok) throw new Error(resolved.code);
          const afterResolution = yield* validation.execution.startOrReuse({
            ...exact,
            now: "2026-07-25T16:17:00.000Z",
          });
          expect(afterResolution.reused).toBe(false);
          if (afterResolution.reused || "blocked" in afterResolution || "active" in afterResolution)
            throw new Error("Expected a fresh Validation Run after Resolution");
          expect(afterResolution.validationRunId).not.toBe(first.validationRunId);
          expect(afterResolution.authority).toMatchObject({
            candidate: { id: captured.candidateId, changeId: captured.changeId },
            blockerHistory: {
              active: null,
              blockers: [{ id: resolved.blocker.id }],
              resolutions: [{ blockerId: resolved.blocker.id }],
            },
            latestResolvedBlockerId: resolved.blocker.id,
          });
          yield* validation.execution.complete({
            validationRunId: afterResolution.validationRunId,
            outcome: "passed",
            now: "2026-07-25T16:18:00.000Z",
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
          if (
            afterSecondResolution.reused ||
            "blocked" in afterSecondResolution ||
            "active" in afterSecondResolution
          )
            throw new Error("Expected a fresh Validation Run after the second Resolution");
          yield* validation.execution.complete({
            validationRunId: afterSecondResolution.validationRunId,
            outcome: "passed",
            now: "2026-07-25T16:22:00.000Z",
          });
          const history = yield* validation.reads.listRunsForCandidate(captured.candidateId);
          expect(history.map((run) => run.id)).toContain(afterResolution.validationRunId);

          yield* repository.operation("corrupt selected Resolution relationship", (sql) =>
            Effect.gen(function* () {
              yield* sql`PRAGMA ignore_check_constraints = ON`;
              yield* sql`UPDATE implementation_blockers SET resolution_content = NULL
                          WHERE id = ${secondResolved.blocker.id}`;
              yield* sql`PRAGMA ignore_check_constraints = OFF`;
            }),
          );
          const incompleteResolutionError = yield* changes.authority
            .getCurrentPassingEvidence(captured.changeId)
            .pipe(Effect.flip);
          expect(incompleteResolutionError).toBeInstanceOf(RepositoryPersistedDataInvalid);
          yield* repository.operation(
            "restore selected Resolution relationship",
            (sql) =>
              sql`UPDATE implementation_blockers SET resolution_content = 'Proceed after the second decision.'
                  WHERE id = ${secondResolved.blocker.id}`,
          );

          yield* repository.operation(
            "corrupt obsolete Blocker content",
            (sql) =>
              sql`UPDATE implementation_blockers SET content = x'01' WHERE id = ${resolved.blocker.id}`,
          );
          expect(yield* changes.authority.getCurrentPassingEvidence(captured.changeId)).toEqual({
            candidateId: captured.candidateId,
            validationRunId: afterSecondResolution.validationRunId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
          });
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

  it.scoped(
    "drops Candidate Publication chronology while preserving current publication facts",
    () =>
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
          if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
          yield* installPublicationIdentity(
            captured.changeId,
            captured.candidateId,
            "legacy-run",
            "head-legacy",
            "2026-07-25T15:30:00.000Z",
          );
          yield* repository.operation("install legacy publication facts", (sql) =>
            Effect.gen(function* () {
              yield* sql`UPDATE changes SET publication_candidate_id = ${captured.candidateId}, publication_validation_run_id = 'legacy-run', publication_owner = 'acme', publication_repo = 'repo', publication_base_branch = 'main', publication_remote_name = 'origin', publication_head_branch = 'legacy', publication_expected_head_sha = 'head-legacy', publication_pr_number = 7, publication_pr_url = 'https://github.test/pull/7' WHERE id = ${captured.changeId}`;
              yield* sql.unsafe(`CREATE TABLE candidate_publications (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              change_id TEXT NOT NULL,
              candidate_id TEXT NOT NULL,
              validation_run_id TEXT NOT NULL,
              change_base_sha TEXT NOT NULL,
              head_sha TEXT NOT NULL,
              publication_owner TEXT NOT NULL,
              publication_repo TEXT NOT NULL,
              publication_base_branch TEXT NOT NULL,
              publication_remote_name TEXT NOT NULL,
              publication_head_branch TEXT NOT NULL,
              pull_request_number INTEGER NOT NULL,
              pull_request_url TEXT NOT NULL,
              published_at TEXT NOT NULL
            )`);
              yield* sql`INSERT INTO candidate_publications (change_id, candidate_id, validation_run_id, change_base_sha, head_sha, publication_owner, publication_repo, publication_base_branch, publication_remote_name, publication_head_branch, pull_request_number, pull_request_url, published_at) VALUES (${captured.changeId}, ${captured.candidateId}, 'legacy-run', 'base-legacy', 'head-legacy', 'acme', 'repo', 'main', 'origin', 'legacy', 7, 'https://github.test/pull/7', '2026-07-25T15:30:00.000Z')`;
              yield* sql.unsafe(`DROP TABLE implementation_decisions`);
              yield* sql.unsafe(`CREATE TABLE implementation_decisions (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              id TEXT NOT NULL UNIQUE,
              change_id TEXT NOT NULL,
              recorded_at TEXT NOT NULL,
              content TEXT NOT NULL,
              choice TEXT,
              rationale TEXT,
              FOREIGN KEY (change_id) REFERENCES changes(id)
            )`);
              yield* sql.unsafe(
                "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
              );
              yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
              yield* rollbackNativeSnapshotWorkspaceMigration(sql);
              yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 11 AND 29`;
              yield* sql`INSERT INTO implementation_decisions (id, change_id, recorded_at, content) VALUES ('legacy-decision', ${captured.changeId}, '2026-07-25T15:30:00.000Z', 'Legacy unstructured decision')`;
            }),
          );
          yield* Effect.scoped(
            Effect.gen(function* () {
              const upgraded = yield* openSqliteChangeTestDependencies();
              yield* installPublicationIdentity(
                captured.changeId,
                captured.candidateId,
                "legacy-run",
                "head-legacy",
                "2026-07-25T15:30:00.000Z",
              );
              expect(
                yield* upgraded.authority.listImplementationDecisions(captured.changeId),
              ).toEqual([]);
              const current = yield* upgraded.reads.getChangeById(captured.changeId);
              expect(current?.publication).toMatchObject({
                candidateId: captured.candidateId,
                validationRunId: "legacy-run",
                expectedHeadSha: "head-legacy",
                pullRequest: { number: 7 },
              });
              const tables = yield* repository.operation(
                "read migrated table names",
                (sql) => sql<{ readonly name: string }>`
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'candidate_publications'
              `,
              );
              expect(tables).toEqual([]);
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
              yield* installPublicationIdentity(
                captured.changeId,
                next.candidateId,
                "next-run",
                "head-next",
                "2026-07-25T15:31:00.000Z",
              );
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
              expect(yield* upgraded.publication.beginPublication(nextPublication)).toMatchObject({
                ok: true,
              });
              expect(
                yield* upgraded.publication.recordPublishedPullRequest({
                  ...nextPublication,
                  pullRequest: { number: 7, url: "https://github.test/pull/7" },
                }),
              ).toMatchObject({ ok: true });
              const revised = yield* upgraded.reads.getChangeById(captured.changeId);
              expect(revised?.publication).toMatchObject({
                candidateId: next.candidateId,
                validationRunId: "next-run",
                expectedHeadSha: "head-next",
                pullRequest: { number: 7 },
              });
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
    withTemporaryState((input) =>
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
          { migration_id: 14, name: "remove_change_readiness" },
          { migration_id: 15, name: "remove_acceptance_context_versions" },
          { migration_id: 16, name: "remove_implementation_decision_content" },
          { migration_id: 17, name: "validation_run_blocker_identity" },
          { migration_id: 18, name: "remove_finding_severity" },
          { migration_id: 19, name: "simplify_reviewer_sessions" },
          { migration_id: 20, name: "remove_candidate_publications" },
          { migration_id: 21, name: "reviewer_transcripts" },
          { migration_id: 22, name: "change_cancel_reason" },
          { migration_id: 23, name: "restrict_lifecycle_states" },
          { migration_id: 24, name: "remove_task_comments" },
          { migration_id: 25, name: "repair_validation_policy_snapshot_ok_field" },
          { migration_id: 26, name: "current_candidate_validation_admissions" },
          { migration_id: 27, name: "remove_candidate_validation_admissions" },
          { migration_id: 28, name: "project_runtime_failure_names" },
          { migration_id: 29, name: "native_snapshot_workspaces" },
        ]);
        expect(identities).toEqual([{ common_directory: input.commonDirectory }]);
        expect(candidateColumns.map(({ name }) => name)).toEqual([
          "id",
          "change_id",
          "change_base_sha",
          "head_sha",
          "created_at",
        ]);
        const workspaceColumns = yield* repositorySql.operation(
          "read Snapshot Workspace shape",
          (sql) =>
            sql<{
              readonly name: string;
            }>`PRAGMA table_info(candidate_snapshot_workspaces)`,
        );
        expect(workspaceColumns.map(({ name }) => name)).toEqual([
          "validation_run_id",
          "expected_commit_sha",
          "cleanup_workspace",
          "created_at",
          "workspace_path",
        ]);
        const decisionColumns = yield* repositorySql.operation(
          "read Implementation Decision shape",
          (sql) => sql<{ readonly name: string }>`PRAGMA table_info(implementation_decisions)`,
        );
        expect(decisionColumns.map(({ name }) => name)).toEqual([
          "sequence",
          "id",
          "change_id",
          "recorded_at",
          "choice",
          "rationale",
        ]);
        const transcriptColumns = yield* repositorySql.operation(
          "read Reviewer Transcript shape",
          (sql) => sql<{ readonly name: string }>`PRAGMA table_info(reviewer_transcripts)`,
        );
        expect(transcriptColumns.map(({ name }) => name)).toEqual([
          "change_id",
          "producer",
          "pi_session_id",
          "file_path",
        ]);
      }),
    ),
  );

  it.effect("upgrades supported lifecycle state records through the strict active schema", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateThrough23;
              yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, cancel_reason, created_at, updated_at) VALUES
                ('BY-1', 1, 'New Task', 'Supported new.', 'new', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'),
                ('BY-2', 2, 'Todo Task', 'Supported todo.', 'todo', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'),
                ('BY-3', 3, 'Done Task', 'Supported done.', 'done', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'),
                ('BY-4', 4, 'Cancelled Task', 'Supported cancelled.', 'cancelled', 'Not needed', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')`;
              yield* sql`INSERT INTO task_comments (id, task_id, created_at, content) VALUES ('comment-1', 'BY-2', '2026-07-25T16:31:00.000Z', 'Keep this comment.')`;
              yield* sql`INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id) VALUES ('BY-2', 'BY-3')`;
              yield* sql`INSERT INTO changes (id, repository_common_directory, branch_ref, task_id, state, close_reason, cancel_reason, created_at, updated_at, closed_at, cleanup_state) VALUES
                ('change-open', ${directory}, 'refs/heads/open', 'BY-2', 'open', NULL, NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', NULL, 'complete'),
                ('change-closed', ${directory}, 'refs/heads/closed', 'BY-3', 'closed', 'completed', NULL, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete')`;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const tasks = yield* repository.operation(
                "read migrated lifecycle Tasks",
                (sql) => sql<{
                  readonly id: string;
                  readonly state: string;
                  readonly cancel_reason: string | null;
                }>`
                  SELECT id, state, cancel_reason FROM tasks ORDER BY numeric_id
                `,
              );
              const changes = yield* repository.operation(
                "read migrated lifecycle Changes",
                (sql) => sql<{
                  readonly id: string;
                  readonly task_id: string | null;
                  readonly state: string;
                }>`
                  SELECT id, task_id, state FROM changes ORDER BY id
                `,
              );
              const commentsTable = yield* repository.operation(
                "verify discarded Task comment storage",
                (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_comments'
                `,
              );
              const dependencies = yield* repository.operation(
                "read migrated Task dependencies",
                (sql) => sql<{
                  readonly dependent_task_id: string;
                  readonly prerequisite_task_id: string;
                }>`
                  SELECT dependent_task_id, prerequisite_task_id FROM task_dependencies
                `,
              );
              const migrations = yield* repository.operation(
                "read lifecycle migration chain",
                (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM effect_sql_migrations WHERE migration_id = 24
                `,
              );
              expect(tasks).toEqual([
                { id: "BY-1", state: "new", cancel_reason: null },
                { id: "BY-2", state: "todo", cancel_reason: null },
                { id: "BY-3", state: "done", cancel_reason: null },
                { id: "BY-4", state: "cancelled", cancel_reason: "Not needed" },
              ]);
              expect(changes).toEqual([
                { id: "change-closed", task_id: "BY-3", state: "closed" },
                { id: "change-open", task_id: "BY-2", state: "open" },
              ]);
              expect(commentsTable).toEqual([]);
              expect(dependencies).toEqual([
                { dependent_task_id: "BY-2", prerequisite_task_id: "BY-3" },
              ]);
              expect(migrations).toEqual([{ name: "remove_task_comments" }]);

              const transientInsert = yield* repository
                .operation(
                  "attempt retired Task state insert",
                  (sql) => sql`
                    INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
                    VALUES ('BY-5', 5, 'Retired', 'Must be rejected.', 'implementing', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')
                  `,
                )
                .pipe(Effect.flip);
              expect(transientInsert).toBeInstanceOf(RepositorySqlOperationFailed);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect(
    "stops a restored database containing each retired Task state with and without a linked Change",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
        (directory) =>
          Effect.gen(function* () {
            for (const state of ["implementing", "blocked", "validating", "ready"] as const) {
              for (const linked of [false, true] as const) {
                const label = `${state}-${linked ? "linked" : "unlinked"}`;
                const stateDirectory = join(directory, label);
                mkdirSync(stateDirectory, { recursive: true });
                const statePath = join(stateDirectory, "state.sqlite");
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const sql = yield* SqlClient.SqlClient;
                    yield* migrateThrough22;
                    yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at) VALUES ('BY-1', 1, 'Restored Task', 'Retired state.', ${state}, '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')`;
                    if (linked) {
                      yield* sql`INSERT INTO changes (id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at, cleanup_state) VALUES ('change-linked', ${stateDirectory}, 'refs/heads/linked', 'BY-1', 'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete')`;
                    }
                  }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
                );

                const failure = yield* Effect.scoped(
                  Effect.gen(function* () {
                    yield* RepositorySql;
                    return null;
                  }).pipe(
                    Effect.provide(
                      repositorySqlLayer({ commonDirectory: stateDirectory, statePath }),
                    ),
                  ),
                ).pipe(Effect.flip);
                expect(failure).toBeInstanceOf(RepositoryRestoredTransientState);
                if (!(failure instanceof RepositoryRestoredTransientState)) return;
                expect(failure.tasks).toEqual([
                  {
                    id: "BY-1",
                    numericId: 1,
                    title: "Restored Task",
                    state,
                    changeId: linked ? "change-linked" : null,
                  },
                ]);
                expect(failure.changes).toEqual([]);
              }
            }
          }),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.effect("stops a restored database containing a retired Change state", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateThrough22;
              yield* sql`INSERT INTO changes (id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at, cleanup_state) VALUES ('change-blocked', ${directory}, 'refs/heads/blocked', NULL, 'blocked', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete')`;
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          const failure = yield* Effect.scoped(
            Effect.gen(function* () {
              yield* RepositorySql;
              return null;
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          ).pipe(Effect.flip);
          expect(failure).toBeInstanceOf(RepositoryRestoredTransientState);
          if (!(failure instanceof RepositoryRestoredTransientState)) return;
          expect(failure.tasks).toEqual([]);
          expect(failure.changes).toEqual([
            { id: "change-blocked", taskId: null, state: "blocked" },
          ]);
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
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
                  yield* sql`ALTER TABLE changes ADD COLUMN readiness TEXT`;
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
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 13 AND 29`;
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

  it.effect("repairs only affected current Validation Policy Snapshot rows on upgrade", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          const buildAffectedPolicy = (instructions: string, acceptanceModel: string) => ({
            agentEnvironment: ["nix", "develop", "-c"] as const,
            prepare: { command: "pnpm install", timeoutSeconds: 60 },
            checks: [{ id: "types", command: "pnpm typecheck", timeoutSeconds: 30 }],
            copyFiles: [".env.test"],
            specialistReviews: [
              {
                id: "security",
                instructions: "Review security.",
                instructionsSource: "repo" as const,
                profile: {
                  agentProfile: "security",
                  scope: "repo" as const,
                  profile: {
                    agentRuntime: "pi" as const,
                    runtimeConfig: { model: "security-model" },
                  },
                },
              },
            ],
            acceptanceReview: {
              instructions,
              instructionsSource: "built_in" as const,
              profile: {
                agentProfile: "acceptance",
                scope: "global" as const,
                profile: {
                  agentRuntime: "pi" as const,
                  runtimeConfig: { model: acceptanceModel },
                },
              },
            },
            acceptanceContext: {
              version: 1 as const,
              title: "Keep the exact intent",
              description: "Review the Candidate against this immutable context.",
            },
          });
          const affectedPolicy = buildAffectedPolicy(
            "Review against the accepted intent.",
            "acceptance-model",
          );
          const reorderedAffectedPolicy = buildAffectedPolicy(
            "Reordered acceptance instructions.",
            "acceptance-reordered-model",
          );
          const affectedCorrectedText = encodeSqliteCandidateValidationPolicy(affectedPolicy);
          const affectedBuggyText = affectedCorrectedText.replace(
            '"acceptanceReview":{',
            '"acceptanceReview":{"ok":true,',
          );
          const reorderedAffectedBuggyText = JSON.stringify({
            ...reorderedAffectedPolicy,
            acceptanceReview: {
              profile: reorderedAffectedPolicy.acceptanceReview.profile,
              ok: true,
              instructions: reorderedAffectedPolicy.acceptanceReview.instructions,
              instructionsSource: reorderedAffectedPolicy.acceptanceReview.instructionsSource,
            },
          });
          const protoAffectedBuggyText = affectedBuggyText.replace(
            '"instructionsSource":"built_in"',
            '"instructionsSource":"built_in","__proto__":{"polluted":true}',
          );
          const whitespaceAffectedBuggyText = `{\n${affectedBuggyText.slice(1)}`;
          const currentPolicy = { checks: [], copyFiles: [], specialistReviews: [] };
          const currentPolicyText = JSON.stringify(currentPolicy);
          const legacyPolicyText =
            '{"checks":[],"copyFiles":[],"specialistReviews":[{"id":"s","instructions":"i","instructionsSource":"repo","agentProfile":"a","profileScope":"repo","profile":{"agentProfile":"a","scope":"repo","profile":{"agentRuntime":"pi"}}}]}';
          const malformedPolicyText = '{"checks":';

          yield* Effect.scoped(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* migrateThrough24;
              yield* sql`
                INSERT INTO changes (
                  id, repository_common_directory, branch_ref, state, created_at, updated_at, cleanup_state
                ) VALUES (
                  'change-repair', ${directory}, 'refs/heads/repair', 'open',
                  '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z', 'complete'
                )
              `;
              yield* sql`
                INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
                VALUES ('candidate-repair', 'change-repair', 'base-sha', 'head-sha', '2026-07-25T16:31:00.000Z')
              `;
              for (const run of [
                {
                  id: "run-affected",
                  policy: affectedBuggyText,
                  now: "2026-07-25T16:32:00.000Z",
                },
                {
                  id: "run-affected-reordered",
                  policy: reorderedAffectedBuggyText,
                  now: "2026-07-25T16:32:00.500Z",
                },
                {
                  id: "run-proto",
                  policy: protoAffectedBuggyText,
                  now: "2026-07-25T16:32:00.750Z",
                },
                {
                  id: "run-whitespace",
                  policy: whitespaceAffectedBuggyText,
                  now: "2026-07-25T16:32:00.875Z",
                },
                { id: "run-legacy", policy: legacyPolicyText, now: "2026-07-25T16:32:01.000Z" },
                {
                  id: "run-malformed",
                  policy: malformedPolicyText,
                  now: "2026-07-25T16:32:02.000Z",
                },
                { id: "run-current", policy: currentPolicyText, now: "2026-07-25T16:32:03.000Z" },
              ] as const) {
                yield* sql`
                  INSERT INTO candidate_validation_runs (
                    id, candidate_id, policy_snapshot, implementation_decisions,
                    latest_resolved_blocker_id, state, outcome, created_at, updated_at
                  ) VALUES (
                    ${run.id}, 'candidate-repair', ${run.policy}, '[]', NULL,
                    'complete', 'passed', ${run.now}, ${run.now}
                  )
                `;
              }
            }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const validation = yield* openSqliteChangeValidationTestDependencies();
              const rows = yield* repository.operation(
                "read repaired Validation Policy Snapshot text",
                (sql) => sql<{ readonly id: string; readonly policySnapshot: string }>`
                  SELECT id, policy_snapshot AS policySnapshot
                  FROM candidate_validation_runs
                  ORDER BY created_at
                `,
              );
              const retiredAdmissionTables = yield* repository.operation(
                "confirm retired validation admission storage is absent",
                (sql) => sql<{ readonly name: string }>`
                  SELECT name FROM sqlite_schema
                  WHERE type = 'table' AND name = 'candidate_validation_admissions'
                `,
              );
              expect(retiredAdmissionTables).toEqual([]);
              const byId = new Map(rows.map((row) => [row.id, row.policySnapshot]));
              expect(byId.get("run-affected")).toBe(affectedCorrectedText);
              expect(byId.get("run-affected-reordered")).toBe(reorderedAffectedBuggyText);
              expect(byId.get("run-proto")).toBe(protoAffectedBuggyText);
              expect(byId.get("run-whitespace")).toBe(whitespaceAffectedBuggyText);
              expect(byId.get("run-legacy")).toBe(legacyPolicyText);
              expect(byId.get("run-malformed")).toBe(malformedPolicyText);
              expect(byId.get("run-current")).toBe(currentPolicyText);

              const repaired = yield* validation.reads.getRunById("run-affected");
              expect(repaired).toBeDefined();
              expect(repaired?.policy).toEqual(affectedPolicy);
              const reorderedError = yield* validation.reads
                .getRunById("run-affected-reordered")
                .pipe(Effect.flip);
              expect(reorderedError).toBeInstanceOf(RepositoryPersistedDataInvalid);
              const protoError = yield* validation.reads.getRunById("run-proto").pipe(Effect.flip);
              expect(protoError).toBeInstanceOf(RepositoryPersistedDataInvalid);
              const whitespaceError = yield* validation.reads
                .getRunById("run-whitespace")
                .pipe(Effect.flip);
              expect(whitespaceError).toBeInstanceOf(RepositoryPersistedDataInvalid);
              const legacyError = yield* validation.reads
                .getRunById("run-legacy")
                .pipe(Effect.flip);
              expect(legacyError).toBeInstanceOf(RepositoryPersistedDataInvalid);
              const malformedError = yield* validation.reads
                .getRunById("run-malformed")
                .pipe(Effect.flip);
              expect(malformedError).toBeInstanceOf(RepositoryPersistedDataInvalid);
              const current = yield* validation.reads.getRunById("run-current");
              expect(current?.policy).toEqual(currentPolicy);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.scoped("upgrades Shared Repository State with a Taskless Change cancellation reason", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const created = yield* starts.create({
          id: "change-cancel-upgrade",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-cancel-upgrade",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-cancel-upgrade"),
          now: "2026-07-17T23:00:00.000Z",
        });
        if (!created.ok) throw new Error(`Change Start failed: ${created.code}`);
        yield* starts.recordPrepareOutcome(created.change.id, null, "2026-07-17T23:01:00.000Z");

        const repository = yield* RepositorySql;
        yield* repository.operation("simulate pre-upgrade Shared Repository State", (sql) =>
          Effect.gen(function* () {
            yield* sql.unsafe("ALTER TABLE changes DROP COLUMN cancel_reason");
            yield* rollbackNativeSnapshotWorkspaceMigration(sql);
            yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 22 AND 29`;
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const upgraded = yield* openSqliteChangeTestDependencies();
            expect(yield* upgraded.reads.getChangeById(created.change.id)).toMatchObject({
              id: created.change.id,
              state: "open",
              cancelReason: null,
            });
            const cancelled = yield* upgraded.delivery.cancelChange({
              changeId: created.change.id,
              reason: "Not needed after upgrade",
              now: "2026-07-17T23:02:00.000Z",
            });
            expect(cancelled).toMatchObject({
              ok: true,
              changed: true,
              change: {
                state: "closed",
                closeReason: "cancelled",
                cancelReason: "Not needed after upgrade",
              },
            });
            expect(yield* upgraded.reads.getChangeById(created.change.id)).toMatchObject({
              state: "closed",
              closeReason: "cancelled",
              cancelReason: "Not needed after upgrade",
            });
            const columns = yield* repository.operation(
              "read upgraded Change cancellation reason column",
              (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
            );
            expect(columns.map((column) => column.name)).toContain("cancel_reason");
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

  it.effect("drops Finding severity while preserving supported Findings", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore legacy Finding severity column", (sql) =>
                Effect.gen(function* () {
                  yield* sql`ALTER TABLE candidate_validation_findings ADD COLUMN severity TEXT`;
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state,
                      created_at, updated_at
                    ) VALUES (
                      'change-severity', ${directory}, 'refs/heads/severity',
                      'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO candidates (
                      id, change_id, change_base_sha, head_sha, created_at
                    ) VALUES (
                      'candidate-severity', 'change-severity', 'base-sha', 'head-sha',
                      '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO candidate_validation_runs (
                      id, candidate_id, policy_snapshot, state, outcome,
                      created_at, updated_at
                    ) VALUES (
                      'run-severity', 'candidate-severity',
                      '{"checks":[{"id":"quality","command":"just quality","timeoutSeconds":60}],"copyFiles":[]}',
                      'complete', 'passed',
                      '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO candidate_validation_rounds (
                      validation_run_id, phase, producer, round_number, status, created_at
                    ) VALUES (
                      'run-severity', 'checks', 'quality', 1, 'failed',
                      '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO candidate_validation_findings (
                      id, validation_run_id, phase, producer, title, description, severity,
                      evidence, files, artifact_refs, created_at, updated_at
                    ) VALUES (
                      'finding-severity', 'run-severity', 'checks', 'quality',
                      'Historical Check Finding', 'Remains readable after migration.', 'high',
                      'exitCode: 1', '[]', '[]',
                      '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 18 AND 29`;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const validation = yield* openSqliteChangeValidationTestDependencies();
              const findings = yield* validation.reads.listFindings("run-severity");
              expect(findings).toEqual([
                {
                  id: "finding-severity",
                  validationRunId: "run-severity",
                  phase: "checks",
                  producer: "quality",
                  title: "Historical Check Finding",
                  description: "Remains readable after migration.",
                  evidence: "exitCode: 1",
                  files: [],
                  artifactRefs: [],
                  createdAt: "2026-07-25T16:30:00.000Z",
                  updatedAt: "2026-07-25T16:30:00.000Z",
                },
              ]);
              const findingColumns = yield* repository.operation(
                "read migrated Finding columns",
                (sql) =>
                  sql<{ readonly name: string }>`PRAGMA table_info(candidate_validation_findings)`,
              );
              expect(findingColumns.map(({ name }) => name)).not.toContain("severity");
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("drops retired Reviewer Session fields while preserving supported sessions", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore legacy Reviewer Session fields", (sql) =>
                Effect.gen(function* () {
                  yield* sql`ALTER TABLE reviewer_sessions ADD COLUMN identity TEXT`;
                  yield* sql`ALTER TABLE reviewer_sessions ADD COLUMN last_candidate_id TEXT`;
                  yield* sql`ALTER TABLE reviewer_sessions ADD COLUMN updated_at TEXT`;
                  yield* sql.unsafe(
                    "CREATE INDEX reviewer_sessions_fingerprint_idx ON reviewer_sessions (fingerprint)",
                  );
                  yield* sql`
                      INSERT INTO changes (
                        id, repository_common_directory, branch_ref, state,
                        created_at, updated_at
                      ) VALUES (
                        'change-session', ${directory}, 'refs/heads/session',
                        'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                      )
                    `;
                  yield* sql`
                      INSERT INTO reviewer_sessions (
                        change_id, producer, identity, fingerprint, session_reference,
                        last_candidate_id, updated_at
                      ) VALUES (
                        'change-session', 'acceptance', 'not-json',
                        'fingerprint-legacy', 'session-legacy',
                        'candidate-legacy', '2026-07-25T16:30:00.000Z'
                      )
                    `;
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 19 AND 29`;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const changes = yield* openSqliteChangeTestDependencies();
              const session = yield* changes.reviewerSessions.getReviewerSession(
                "change-session",
                "acceptance",
              );
              expect(session).toEqual({
                changeId: "change-session",
                producer: "acceptance",
                fingerprint: "fingerprint-legacy",
                sessionReference: "session-legacy",
              });
              yield* changes.reviewerSessions.saveReviewerSession({
                changeId: "change-session",
                producer: "acceptance",
                fingerprint: "fingerprint-new",
                sessionReference: "session-new",
              });
              const replaced = yield* changes.reviewerSessions.getReviewerSession(
                "change-session",
                "acceptance",
              );
              expect(replaced).toEqual({
                changeId: "change-session",
                producer: "acceptance",
                fingerprint: "fingerprint-new",
                sessionReference: "session-new",
              });
              const sessionColumns = yield* repository.operation(
                "read migrated Reviewer Session columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(reviewer_sessions)`,
              );
              expect(sessionColumns.map(({ name }) => name)).toEqual([
                "change_id",
                "producer",
                "fingerprint",
                "session_reference",
              ]);
              const indexRows = yield* repository.operation(
                "read migrated Reviewer Session indexes",
                (sql) =>
                  sql<{ readonly name: string }>`
                    SELECT name FROM sqlite_master
                    WHERE type = 'index' AND name = 'reviewer_sessions_fingerprint_idx'
                  `,
              );
              expect(indexRows).toEqual([]);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("preserves active Reviewer Sessions while adding Reviewer Transcript storage", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore pre-transcript storage", (sql) =>
                Effect.gen(function* () {
                  yield* sql.unsafe(`DROP TABLE reviewer_transcripts`);
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 21 AND 29`;
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state,
                      created_at, updated_at
                    ) VALUES (
                      'change-session-retained', ${directory}, 'refs/heads/retained',
                      'open', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO reviewer_sessions (
                      change_id, producer, fingerprint, session_reference
                    ) VALUES (
                      'change-session-retained', 'acceptance', 'fingerprint-retained', 'session-1'
                    )
                  `;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const changes = yield* openSqliteChangeTestDependencies();
              const session = yield* changes.reviewerSessions.getReviewerSession(
                "change-session-retained",
                "acceptance",
              );
              expect(session).toEqual({
                changeId: "change-session-retained",
                producer: "acceptance",
                fingerprint: "fingerprint-retained",
                sessionReference: "session-1",
              });
              yield* changes.reviewerTranscripts.recordReviewerTranscripts({
                changeId: "change-session-retained",
                transcripts: [
                  {
                    changeId: "change-session-retained",
                    producer: "acceptance",
                    piSessionId: "session-1",
                    filePath: "reviewer-sessions/review_session-1.jsonl",
                  },
                ],
              });
              yield* changes.reviewerTranscripts.recordReviewerTranscripts({
                changeId: "change-session-retained",
                transcripts: [
                  {
                    changeId: "change-session-retained",
                    producer: "acceptance",
                    piSessionId: "session-1",
                    filePath: "reviewer-sessions/review_session-1.jsonl",
                  },
                ],
              });
              const transcripts =
                yield* changes.reviewerTranscripts.listReviewerTranscripts(
                  "change-session-retained",
                );
              expect(transcripts).toEqual([
                {
                  changeId: "change-session-retained",
                  producer: "acceptance",
                  piSessionId: "session-1",
                  filePath: "reviewer-sessions/review_session-1.jsonl",
                },
              ]);
              const migrations = yield* repository.operation(
                "read re-applied Reviewer Transcript migration",
                (sql) =>
                  sql<{ readonly name: string }>`
                    SELECT name FROM effect_sql_migrations WHERE migration_id IN (21, 22)
                  `,
              );
              expect(migrations).toEqual([
                { name: "reviewer_transcripts" },
                { name: "change_cancel_reason" },
              ]);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
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
        yield* changes.reviewerTranscripts.recordReviewerTranscripts({
          changeId: "change-transcript-a",
          transcripts: [
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
          ],
        });
        yield* changes.reviewerTranscripts.recordReviewerTranscripts({
          changeId: "change-transcript-b",
          transcripts: [
            {
              changeId: "change-transcript-b",
              producer: "acceptance",
              piSessionId: "session-b-1",
              filePath: "reviewer-sessions/review_session-b-1.jsonl",
            },
          ],
        });

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

  it.scoped("keeps Reviewer Transcript references after active Reviewer Sessions are removed", () =>
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
        yield* changes.reviewerSessions.saveReviewerSession({
          changeId: "change-transcript-retained",
          producer: "acceptance",
          fingerprint: "fingerprint",
          sessionReference: "session-live",
        });
        yield* changes.reviewerTranscripts.recordReviewerTranscripts({
          changeId: "change-transcript-retained",
          transcripts: [
            {
              changeId: "change-transcript-retained",
              producer: "acceptance",
              piSessionId: "session-live",
              filePath: "reviewer-sessions/review_session-live.jsonl",
            },
          ],
        });

        yield* changes.reviewerSessions.removeReviewerSessions("change-transcript-retained");

        const live = yield* changes.reviewerSessions.getReviewerSession(
          "change-transcript-retained",
          "acceptance",
        );
        expect(live).toBeUndefined();
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
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 13 AND 29`;
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

  it.effect("preserves supported Change data while removing persisted readiness", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore persisted readiness facts", (sql) =>
                Effect.gen(function* () {
                  yield* sql`ALTER TABLE changes ADD COLUMN readiness TEXT`;
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state, created_at, updated_at,
                      base_ref, base_remote_url, starting_commit, worktree_path,
                      readiness, prepare_command, prepare_timeout_seconds, prepare_failure,
                      publication_candidate_id, publication_validation_run_id, publication_owner,
                      publication_repo, publication_base_branch, publication_remote_name,
                      publication_head_branch, publication_expected_head_sha,
                      publication_pr_number, publication_pr_url
                    ) VALUES (
                      'change-with-failure', ${directory}, 'refs/heads/with-failure', 'open',
                      '2026-07-25T17:30:00.000Z', '2026-07-25T17:30:00.000Z',
                      'refs/remotes/origin/main', 'https://github.com/acme/repo.git', 'base-sha',
                      ${join(directory, "worktree")}, 'prepare_failed', 'just prepare', 1200,
                      '{"command":"just prepare","exitCode":7,"timedOut":false,"stdout":"","stderr":"failed"}',
                      'candidate-1', 'run-1', 'acme', 'repo', 'main', 'origin',
                      'with-failure', 'head-sha', 42, 'https://github.com/acme/repo/pull/42'
                    )
                  `;
                  yield* sql`
                    INSERT INTO candidates (
                      id, change_id, change_base_sha, head_sha, created_at
                    ) VALUES (
                      'candidate-1', 'change-with-failure', 'base-sha', 'head-sha',
                      '2026-07-25T17:30:00.000Z'
                    )
                  `;
                  yield* sql`
                    INSERT INTO candidate_validation_runs (
                      id, candidate_id, policy_snapshot, implementation_decisions,
                      latest_resolved_blocker_id, state, outcome, created_at, updated_at
                    ) VALUES (
                      'run-1', 'candidate-1',
                      '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
                      'complete', 'passed', '2026-07-25T17:30:00.000Z',
                      '2026-07-25T17:30:00.000Z'
                    )
                  `;
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 14 AND 29`;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const changeColumns = yield* repository.operation(
                "read migrated Change columns",
                (sql) => sql<{ readonly name: string }>`PRAGMA table_info(changes)`,
              );
              expect(changeColumns.map(({ name }) => name)).not.toContain("readiness");
              const changes = yield* openSqliteChangeTestDependencies();
              const stored = yield* changes.reads.getChangeById("change-with-failure");
              expect(stored).toMatchObject({
                id: "change-with-failure",
                state: "open",
                baseRef: "refs/remotes/origin/main",
                worktreePath: join(directory, "worktree"),
                prepare: { command: "just prepare", timeoutSeconds: 1200 },
                prepareFailure: {
                  command: "just prepare",
                  exitCode: 7,
                  timedOut: false,
                  stdout: "",
                  stderr: "failed",
                },
                publication: {
                  candidateId: "candidate-1",
                  validationRunId: "run-1",
                  headBranch: "with-failure",
                  expectedHeadSha: "head-sha",
                  pullRequest: { number: 42, url: "https://github.com/acme/repo/pull/42" },
                },
              });
              expect(stored).not.toHaveProperty("readiness");
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect(
    "removes Acceptance Context version history while preserving current context and snapshots",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
        (directory) =>
          Effect.gen(function* () {
            const statePath = join(directory, "state.sqlite");
            yield* Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                yield* repository.operation("restore Acceptance Context version history", (sql) =>
                  Effect.gen(function* () {
                    yield* sql.unsafe(`CREATE TABLE acceptance_context_versions (
                      change_id TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      context TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      PRIMARY KEY (change_id, version),
                      FOREIGN KEY (change_id) REFERENCES changes(id)
                    )`);
                    yield* sql`
                      INSERT INTO tasks (
                        id, numeric_id, title, description, state, cancel_reason,
                        created_at, updated_at
                      ) VALUES (
                        'BY-1', 1, 'Current intent', 'Must survive.', 'todo', NULL,
                        '2026-07-25T18:00:00.000Z', '2026-07-25T18:00:00.000Z'
                      )
                    `;
                    yield* sql`
                      INSERT INTO changes (
                        id, repository_common_directory, branch_ref, task_id, state, close_reason,
                        created_at, updated_at, closed_at, acceptance_context, base_ref,
                        base_remote_url, starting_commit, worktree_path
                      ) VALUES (
                        'change-with-context', ${directory}, 'refs/heads/with-context', 'BY-1',
                        'open', NULL, '2026-07-25T18:00:00.000Z', '2026-07-25T18:00:00.000Z',
                        NULL,
                        '{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}',
                        'refs/remotes/origin/main', 'https://github.test/acme/repo.git',
                        'base-sha', ${join(directory, "worktree")}
                      )
                    `;
                    yield* sql`
                      INSERT INTO acceptance_context_versions (change_id, version, context, created_at)
                      VALUES (
                        'change-with-context', 1,
                        '{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}',
                        '2026-07-25T18:00:00.000Z'
                      )
                    `;
                    yield* sql`
                      INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
                      VALUES ('candidate-1', 'change-with-context', 'base-sha', 'head-sha', '2026-07-25T18:01:00.000Z')
                    `;
                    yield* sql`
                      INSERT INTO candidate_validation_runs (
                        id, candidate_id, policy_snapshot, state, outcome, created_at, updated_at
                      ) VALUES (
                        'run-1', 'candidate-1',
                        '{"checks":[],"copyFiles":[],"specialistReviews":[],"acceptanceContext":{"version":1,"title":"Current intent","description":"Must survive.","comments":["Historical Task comment."]}}',
                        'complete', 'passed', '2026-07-25T18:02:00.000Z', '2026-07-25T18:02:00.000Z'
                      )
                    `;
                    yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                    yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 15 AND 29`;
                  }),
                );
              }).pipe(
                Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath })),
              ),
            );

            yield* Effect.scoped(
              Effect.gen(function* () {
                const repository = yield* RepositorySql;
                const tables = yield* repository.operation(
                  "read migrated Acceptance Context version tables",
                  (sql) => sql<{ readonly name: string }>`
                    SELECT name FROM sqlite_master
                    WHERE type = 'table' AND name = 'acceptance_context_versions'
                  `,
                );
                expect(tables).toEqual([]);
                const changes = yield* openSqliteChangeTestDependencies();
                const stored = yield* changes.reads.getChangeById("change-with-context");
                expect(stored?.acceptanceContext).toEqual({
                  version: 1,
                  title: "Current intent",
                  description: "Must survive.",
                  comments: ["Historical Task comment."],
                });
                const runs = yield* repository.operation(
                  "read preserved Validation Run snapshot",
                  (sql) => sql<{ readonly policySnapshot: string }>`
                    SELECT policy_snapshot AS policySnapshot
                    FROM candidate_validation_runs WHERE id = 'run-1'
                  `,
                );
                const run = runs[0];
                expect(run).toBeDefined();
                if (run !== undefined) {
                  expect(JSON.parse(run.policySnapshot)).toMatchObject({
                    acceptanceContext: {
                      version: 1,
                      title: "Current intent",
                      description: "Must survive.",
                      comments: ["Historical Task comment."],
                    },
                  });
                }
              }).pipe(
                Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath })),
              ),
            );
          }),
        (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.effect("deletes legacy-only Implementation Decisions and preserves structured rows", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore Implementation Decision rows", (sql) =>
                Effect.gen(function* () {
                  yield* sql.unsafe(`DROP TABLE implementation_decisions`);
                  yield* sql.unsafe(`CREATE TABLE implementation_decisions (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    change_id TEXT NOT NULL,
                    recorded_at TEXT NOT NULL,
                    content TEXT NOT NULL,
                    choice TEXT,
                    rationale TEXT,
                    FOREIGN KEY (change_id) REFERENCES changes(id)
                  )`);
                  yield* sql.unsafe(
                    "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
                  );
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state, close_reason,
                      created_at, updated_at, closed_at
                    ) VALUES (
                      'change-decisions', ${directory}, 'refs/heads/decisions',
                      'open', NULL, '2026-07-25T18:30:00.000Z', '2026-07-25T18:30:00.000Z', NULL
                    )
                  `;
                  yield* sql`
                    INSERT INTO implementation_decisions (
                      id, change_id, recorded_at, content, choice, rationale
                    ) VALUES (
                      'structured-decision', 'change-decisions', '2026-07-25T18:31:00.000Z',
                      '', 'Structured choice', 'Structured rationale'
                    )
                  `;
                  yield* sql`
                    INSERT INTO implementation_decisions (
                      id, change_id, recorded_at, content
                    ) VALUES (
                      'legacy-decision', 'change-decisions', '2026-07-25T18:32:00.000Z',
                      'Legacy unstructured decision'
                    )
                  `;
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 16 AND 29`;
                }),
              );
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );

          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              const changes = yield* openSqliteChangeTestDependencies();
              const decisions =
                yield* changes.authority.listImplementationDecisions("change-decisions");
              expect(decisions).toEqual([
                {
                  id: "structured-decision",
                  changeId: "change-decisions",
                  sequence: 1,
                  recordedAt: "2026-07-25T18:31:00.000Z",
                  choice: "Structured choice",
                  rationale: "Structured rationale",
                },
              ]);
              const decisionColumns = yield* repository.operation(
                "read migrated Implementation Decision columns",
                (sql) =>
                  sql<{ readonly name: string }>`PRAGMA table_info(implementation_decisions)`,
              );
              expect(decisionColumns.map(({ name }) => name)).not.toContain("content");
              const migrations = yield* repository.operation(
                "read re-run migration",
                (sql) =>
                  sql<{ readonly name: string }>`
                    SELECT name FROM effect_sql_migrations WHERE migration_id = 16
                  `,
              );
              expect(migrations).toEqual([{ name: "remove_implementation_decision_content" }]);
            }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
          );
        }),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("stops migration with Decision and Change facts for malformed partial rows", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-repository-sql-"))),
      (directory) =>
        Effect.gen(function* () {
          const statePath = join(directory, "state.sqlite");
          yield* Effect.scoped(
            Effect.gen(function* () {
              const repository = yield* RepositorySql;
              yield* repository.operation("restore malformed partial Decision row", (sql) =>
                Effect.gen(function* () {
                  yield* sql.unsafe(`DROP TABLE implementation_decisions`);
                  yield* sql.unsafe(`CREATE TABLE implementation_decisions (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    change_id TEXT NOT NULL,
                    recorded_at TEXT NOT NULL,
                    content TEXT NOT NULL,
                    choice TEXT,
                    rationale TEXT,
                    FOREIGN KEY (change_id) REFERENCES changes(id)
                  )`);
                  yield* sql.unsafe(
                    "CREATE INDEX implementation_decisions_change_sequence_idx ON implementation_decisions (change_id, sequence)",
                  );
                  yield* sql`
                    INSERT INTO changes (
                      id, repository_common_directory, branch_ref, state, close_reason,
                      created_at, updated_at, closed_at
                    ) VALUES (
                      'change-partial', ${directory}, 'refs/heads/partial',
                      'open', NULL, '2026-07-25T18:40:00.000Z', '2026-07-25T18:40:00.000Z', NULL
                    )
                  `;
                  yield* sql`
                    INSERT INTO implementation_decisions (
                      id, change_id, recorded_at, content, choice, rationale
                    ) VALUES (
                      'partial-decision', 'change-partial', '2026-07-25T18:41:00.000Z',
                      'Legacy text', 'Partial choice', NULL
                    )
                  `;
                  yield* sql`DROP TABLE IF EXISTS reviewer_transcripts`;
                  yield* rollbackNativeSnapshotWorkspaceMigration(sql);
                  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 16 AND 29`;
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
          expect(String(migrationError.cause)).toContain("decisionId=partial-decision");
          expect(String(migrationError.cause)).toContain("changeId=change-partial");
          expect(String(migrationError.cause)).toContain("without inventing Choice or Rationale");
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
              yield* repository.operation("drop migrated Tasks", (sql) => sql`DROP TABLE tasks`);
              yield* repository.operation(
                "replace Tasks with an incompatible view",
                (sql) => sql`CREATE VIEW tasks AS SELECT 1 AS sequence`,
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

  it.scoped("reports a malformed Change record through the typed error channel", () =>
    withTemporaryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const started = yield* starts.create({
          id: "change-malformed",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/but-why/by-1-malformed",
          baseRef: "main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "1111111111111111111111111111111111111111",
          worktreePath: join(input.commonDirectory, "worktrees", "by-1-malformed"),
          now: "2026-07-17T23:10:00.000Z",
        });
        if (!started.ok) throw new Error(`Change Start failed: ${started.code}`);

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "corrupt Change publication marker",
          (sql) => sql`
            UPDATE changes
            SET publication_candidate_id = 'candidate-malformed'
            WHERE id = ${started.change.id}
          `,
        );

        const error = yield* changes.reads.getChangeById(started.change.id).pipe(Effect.flip);
        expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(error).toMatchObject({
          _tag: "RepositoryPersistedDataInvalid",
          operationName: "read Change",
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
          expect(yield* readMigrationCount).toBe(29);
          expect(yield* readMigrationCount).toBe(29);
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
              expect(migrations.length).toBe(29);
              expect(migrations.map((row) => row.migration_id)).toEqual(
                Array.from({ length: 29 }, (_, index) => index + 1),
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
              migrationCount: 29,
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
