import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
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
import { currentCandidateValidationAdmissionsMigration } from "../../src/sqlite/migrations/0026_current_candidate_validation_admissions.js";
import { removeCandidateValidationAdmissionsMigration } from "../../src/sqlite/migrations/0027_remove_candidate_validation_admissions.js";
import { projectRuntimeFailureNamesMigration } from "../../src/sqlite/migrations/0028_project_runtime_failure_names.js";
import { enforceStableStorageConstraintsMigration } from "../../src/sqlite/migrations/0029_enforce_stable_storage_constraints.js";
import { nativeSnapshotWorkspacesMigration } from "../../src/sqlite/migrations/0030_native_snapshot_workspaces.js";
import { preNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0031_pre_native_snapshot_workspace_cleanup.js";
import { backfillPreNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0032_backfill_pre_native_snapshot_workspace_cleanup.js";
import { removePreNativeSnapshotWorkspaceCleanupMigration } from "../../src/sqlite/migrations/0033_remove_pre_native_snapshot_workspace_cleanup.js";
import { taskReviewsMigration } from "../../src/sqlite/migrations/0034_task_reviews.js";
import { taskReviewerSessionsMigration } from "../../src/sqlite/migrations/0035_task_reviewer_sessions.js";

export const testRepositoryMigrationLedger = [
  ["0001_baseline", baselineMigration],
  ["0002_reviewer_sessions", reviewerSessionsMigration],
  ["0003_implementation_decisions", implementationDecisionsMigration],
  ["0004_implementation_blockers", implementationBlockersMigration],
  ["0005_acceptance_context_versions", acceptanceContextVersionsMigration],
  ["0006_reconcile_implementation_blocker_storage", reconcileImplementationBlockerStorageMigration],
  ["0007_reviewer_sessions_per_producer", specialistReviewerSessionsMigration],
  ["0008_recover_published_remote_branch_cleanup", recoverPublishedRemoteBranchCleanupMigration],
  ["0009_active_validation_runs", activeValidationRunsMigration],
  ["0010_validation_workspace_paths", validationWorkspacePathsMigration],
  ["0011_candidate_publications", candidatePublicationsMigration],
  ["0012_structured_implementation_decisions", structuredImplementationDecisionsMigration],
  ["0013_remove_no_change_completion", removeNoChangeCompletionMigration],
  ["0014_remove_change_readiness", removeChangeReadinessMigration],
  ["0015_remove_acceptance_context_versions", removeAcceptanceContextVersionsMigration],
  ["0016_remove_implementation_decision_content", removeImplementationDecisionContentMigration],
  ["0017_validation_run_blocker_identity", validationRunBlockerIdentityMigration],
  ["0018_remove_finding_severity", removeFindingSeverityMigration],
  ["0019_simplify_reviewer_sessions", simplifyReviewerSessionsMigration],
  ["0020_remove_candidate_publications", removeCandidatePublicationsMigration],
  ["0021_reviewer_transcripts", reviewerTranscriptsMigration],
  ["0022_change_cancel_reason", changeCancelReasonMigration],
  ["0023_restrict_lifecycle_states", restrictLifecycleStatesMigration],
  ["0024_remove_task_comments", removeTaskCommentsMigration],
  [
    "0025_repair_validation_policy_snapshot_ok_field",
    repairValidationPolicySnapshotOkFieldMigration,
  ],
  ["0026_current_candidate_validation_admissions", currentCandidateValidationAdmissionsMigration],
  ["0027_remove_candidate_validation_admissions", removeCandidateValidationAdmissionsMigration],
  ["0028_project_runtime_failure_names", projectRuntimeFailureNamesMigration],
  ["0029_enforce_stable_storage_constraints", enforceStableStorageConstraintsMigration],
  ["0030_native_snapshot_workspaces", nativeSnapshotWorkspacesMigration],
  ["0031_pre_native_snapshot_workspace_cleanup", preNativeSnapshotWorkspaceCleanupMigration],
  [
    "0032_backfill_pre_native_snapshot_workspace_cleanup",
    backfillPreNativeSnapshotWorkspaceCleanupMigration,
  ],
  [
    "0033_remove_pre_native_snapshot_workspace_cleanup",
    removePreNativeSnapshotWorkspaceCleanupMigration,
  ],
  ["0034_task_reviews", taskReviewsMigration],
  ["0035_task_reviewer_sessions", taskReviewerSessionsMigration],
] as const;

export const migrateTestRepositoryThrough = (lastMigrationId: number) => {
  const prefixEnd = testRepositoryMigrationLedger.findIndex(
    ([key]) => Number(key.slice(0, 4)) === lastMigrationId,
  );
  if (prefixEnd === -1) {
    throw new Error(`Unknown test repository migration: ${lastMigrationId}`);
  }

  const migrate = Migrator.make({})({
    loader: Migrator.fromRecord(
      Object.fromEntries(testRepositoryMigrationLedger.slice(0, prefixEnd + 1)),
    ),
  });

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe("PRAGMA foreign_keys = OFF");
    yield* migrate;
    yield* sql.unsafe("PRAGMA foreign_keys = ON");
  });
};
