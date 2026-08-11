import * as Migrator from "@effect/sql/Migrator";

import { baselineMigration as baseline } from "./migrations/0001_baseline.js";
import { reviewerSessionsMigration as reviewerSessions } from "./migrations/0002_reviewer_sessions.js";
import { implementationDecisionsMigration as implementationDecisions } from "./migrations/0003_implementation_decisions.js";
import { implementationBlockersMigration as implementationBlockers } from "./migrations/0004_implementation_blockers.js";
import { acceptanceContextVersionsMigration as acceptanceContextVersions } from "./migrations/0005_acceptance_context_versions.js";
import { reconcileImplementationBlockerStorageMigration as reconcileImplementationBlockerStorage } from "./migrations/0006_reconcile_implementation_blocker_storage.js";
import { specialistReviewerSessionsMigration as specialistReviewerSessions } from "./migrations/0007_reviewer_sessions_per_producer.js";
import { recoverPublishedRemoteBranchCleanupMigration as recoverPublishedRemoteBranchCleanup } from "./migrations/0008_recover_published_remote_branch_cleanup.js";
import { activeValidationRunsMigration as activeValidationRuns } from "./migrations/0009_active_validation_runs.js";
import { validationWorkspacePathsMigration as validationWorkspacePaths } from "./migrations/0010_validation_workspace_paths.js";
import { candidatePublicationsMigration as candidatePublications } from "./migrations/0011_candidate_publications.js";
import { structuredImplementationDecisionsMigration as structuredImplementationDecisions } from "./migrations/0012_structured_implementation_decisions.js";
import { removeNoChangeCompletionMigration as removeNoChangeCompletion } from "./migrations/0013_remove_no_change_completion.js";
import { removeChangeReadinessMigration as removeChangeReadiness } from "./migrations/0014_remove_change_readiness.js";
import { removeAcceptanceContextVersionsMigration as removeAcceptanceContextVersions } from "./migrations/0015_remove_acceptance_context_versions.js";
import { removeImplementationDecisionContentMigration as removeImplementationDecisionContent } from "./migrations/0016_remove_implementation_decision_content.js";
import { validationRunBlockerIdentityMigration as validationRunBlockerIdentity } from "./migrations/0017_validation_run_blocker_identity.js";
import { removeFindingSeverityMigration as removeFindingSeverity } from "./migrations/0018_remove_finding_severity.js";
import { simplifyReviewerSessionsMigration as simplifyReviewerSessions } from "./migrations/0019_simplify_reviewer_sessions.js";
import { removeCandidatePublicationsMigration as removeCandidatePublications } from "./migrations/0020_remove_candidate_publications.js";
import { reviewerTranscriptsMigration as reviewerTranscripts } from "./migrations/0021_reviewer_transcripts.js";
import { changeCancelReasonMigration as changeCancelReason } from "./migrations/0022_change_cancel_reason.js";
import { restrictLifecycleStatesMigration as restrictLifecycleStates } from "./migrations/0023_restrict_lifecycle_states.js";
import { removeTaskCommentsMigration as removeTaskComments } from "./migrations/0024_remove_task_comments.js";
import { repairValidationPolicySnapshotOkFieldMigration as repairValidationPolicySnapshotOkField } from "./migrations/0025_repair_validation_policy_snapshot_ok_field.js";
import { currentCandidateValidationAdmissionsMigration as currentCandidateValidationAdmissions } from "./migrations/0026_current_candidate_validation_admissions.js";
import { removeCandidateValidationAdmissionsMigration as removeCandidateValidationAdmissions } from "./migrations/0027_remove_candidate_validation_admissions.js";
import { projectRuntimeFailureNamesMigration as projectRuntimeFailureNames } from "./migrations/0028_project_runtime_failure_names.js";
import { enforceStableStorageConstraintsMigration as enforceStableStorageConstraints } from "./migrations/0029_enforce_stable_storage_constraints.js";
import { nativeSnapshotWorkspacesMigration as nativeSnapshotWorkspaces } from "./migrations/0030_native_snapshot_workspaces.js";
import { preNativeSnapshotWorkspaceCleanupMigration as preNativeSnapshotWorkspaceCleanup } from "./migrations/0031_pre_native_snapshot_workspace_cleanup.js";
import { backfillPreNativeSnapshotWorkspaceCleanupMigration as backfillPreNativeSnapshotWorkspaceCleanup } from "./migrations/0032_backfill_pre_native_snapshot_workspace_cleanup.js";
import { removePreNativeSnapshotWorkspaceCleanupMigration as removePreNativeSnapshotWorkspaceCleanup } from "./migrations/0033_remove_pre_native_snapshot_workspace_cleanup.js";
import { taskReviewsMigration as taskReviews } from "./migrations/0034_task_reviews.js";

const migrations = {
  "0001_baseline": baseline,
  "0002_reviewer_sessions": reviewerSessions,
  "0003_implementation_decisions": implementationDecisions,
  "0004_implementation_blockers": implementationBlockers,
  "0005_acceptance_context_versions": acceptanceContextVersions,
  "0006_reconcile_implementation_blocker_storage": reconcileImplementationBlockerStorage,
  "0007_reviewer_sessions_per_producer": specialistReviewerSessions,
  "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanup,
  "0009_active_validation_runs": activeValidationRuns,
  "0010_validation_workspace_paths": validationWorkspacePaths,
  "0011_candidate_publications": candidatePublications,
  "0012_structured_implementation_decisions": structuredImplementationDecisions,
  "0013_remove_no_change_completion": removeNoChangeCompletion,
  "0014_remove_change_readiness": removeChangeReadiness,
  "0015_remove_acceptance_context_versions": removeAcceptanceContextVersions,
  "0016_remove_implementation_decision_content": removeImplementationDecisionContent,
  "0017_validation_run_blocker_identity": validationRunBlockerIdentity,
  "0018_remove_finding_severity": removeFindingSeverity,
  "0019_simplify_reviewer_sessions": simplifyReviewerSessions,
  "0020_remove_candidate_publications": removeCandidatePublications,
  "0021_reviewer_transcripts": reviewerTranscripts,
  "0022_change_cancel_reason": changeCancelReason,
  "0023_restrict_lifecycle_states": restrictLifecycleStates,
  "0024_remove_task_comments": removeTaskComments,
  "0025_repair_validation_policy_snapshot_ok_field": repairValidationPolicySnapshotOkField,
  "0026_current_candidate_validation_admissions": currentCandidateValidationAdmissions,
  "0027_remove_candidate_validation_admissions": removeCandidateValidationAdmissions,
  "0028_project_runtime_failure_names": projectRuntimeFailureNames,
  "0029_enforce_stable_storage_constraints": enforceStableStorageConstraints,
  "0030_native_snapshot_workspaces": nativeSnapshotWorkspaces,
  "0031_pre_native_snapshot_workspace_cleanup": preNativeSnapshotWorkspaceCleanup,
  "0032_backfill_pre_native_snapshot_workspace_cleanup": backfillPreNativeSnapshotWorkspaceCleanup,
  "0033_remove_pre_native_snapshot_workspace_cleanup": removePreNativeSnapshotWorkspaceCleanup,
  "0034_task_reviews": taskReviews,
};

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
});

export const repositoryMigrationIds: readonly number[] = Object.keys(migrations)
  .map((key) => /^(\d+)_/.exec(key)?.[1])
  .filter((id): id is string => id !== undefined)
  .map(Number)
  .sort((left, right) => left - right);
