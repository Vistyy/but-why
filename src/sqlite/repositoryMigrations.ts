import * as Migrator from "@effect/sql/Migrator";

import { migration as baseline } from "./migrations/0001_baseline.js";
import { migration as reviewerSessions } from "./migrations/0002_reviewer_sessions.js";
import { migration as implementationDecisions } from "./migrations/0003_implementation_decisions.js";
import { migration as implementationBlockers } from "./migrations/0004_implementation_blockers.js";
import { migration as acceptanceContextVersions } from "./migrations/0005_acceptance_context_versions.js";
import { migration as reconcileImplementationBlockerStorage } from "./migrations/0006_reconcile_implementation_blocker_storage.js";
import { migration as specialistReviewerSessions } from "./migrations/0007_reviewer_sessions_per_producer.js";
import { migration as recoverPublishedRemoteBranchCleanup } from "./migrations/0008_recover_published_remote_branch_cleanup.js";

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
  }),
});
