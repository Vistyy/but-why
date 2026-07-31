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
import { backfillActiveValidationRunsMigration as backfillActiveValidationRuns } from "./migrations/0011_backfill_active_validation_runs.js";

export const migrateRepositoryState = Migrator.make({})({
  loader: Migrator.fromRecord({
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
    "0011_backfill_active_validation_runs": backfillActiveValidationRuns,
  }),
});
