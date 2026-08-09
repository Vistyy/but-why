import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

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
import { repairValidationPolicySnapshotOkFieldMigration } from "../../src/sqlite/migrations/0025_repair_validation_policy_snapshot_ok_field.js";
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
import { repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskReviewPolicySnapshot } from "../../src/task/taskReview.js";

const migrateThrough25 = Migrator.make({})({
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
    "0025_repair_validation_policy_snapshot_ok_field":
      repairValidationPolicySnapshotOkFieldMigration,
  }),
});

const policy: TaskReviewPolicySnapshot = {
  version: 1,
  instructions: "Review",
  instructionsSource: "built_in",
  profile: { agentProfile: "task-reviewer", scope: "repo" },
};

const baseCommit = "abcdef0123456789abcdef0123456789abcdef01";

it.effect("upgrades Shared Repository State at 0025 and admits Task Reviews", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "but-why-task-review-upgrade-"))),
    (directory) =>
      Effect.gen(function* () {
        const statePath = join(directory, "state.sqlite");

        yield* Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* migrateThrough25;
            yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, cancel_reason, created_at, updated_at) VALUES
              ('BY-1', 1, 'Upgrade Task', 'Representative task before Task Reviews.', 'new', NULL, '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z')`;
          }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const started = yield* reviews.startOrReuse({
              taskId: publicTaskId("BY-1"),
              baseCommit,
              policy,
              reviewId: "review-upgraded",
              workspaceSetup: {
                tempRefName: "refs/but-why/task-reviews/review-upgraded/review",
                worktreePath: "/tmp/worktrees/task-reviews-review-upgraded",
              },
              now: "2026-08-01T09:05:00.000Z",
            });
            expect(started).toMatchObject({
              ok: true,
              reused: false,
              reviewId: "review-upgraded",
            });

            const completed = yield* reviews.complete({
              reviewId: "review-upgraded",
              outcome: "blocked",
              findings: [
                {
                  id: "review-upgraded-F1",
                  reviewId: "review-upgraded",
                  title: "Needs evidence",
                  description: "Provide repository evidence.",
                  evidence: "command: none",
                  files: [],
                },
              ],
              now: "2026-08-01T09:10:00.000Z",
            });
            expect(completed).toMatchObject({ ok: true });

            const recorded = yield* reviews.getReviewById("review-upgraded");
            expect(recorded).toMatchObject({
              id: "review-upgraded",
              taskId: "BY-1",
              state: "complete",
              outcome: "blocked",
              baseCommit,
            });
            expect(yield* reviews.listFindings("review-upgraded")).toHaveLength(1);
            expect(yield* reviews.getActiveForTask(publicTaskId("BY-1"))).toBeUndefined();
          }).pipe(Effect.provide(repositorySqlLayer({ commonDirectory: directory, statePath }))),
        );
      }),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  ),
);
