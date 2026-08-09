import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { isTaskPrefix } from "../../src/contracts/taskPrefix.js";
import { initRepoLocalContext } from "../../src/init/repoContext.js";
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
import { nodeSqliteLayer } from "../../src/sqlite/nodeSqliteClient.js";
import { createGitRepo, runByInProcessEffect } from "../support/by-cli.js";

const writeConfig = (root: string, taskPrefix = "BY") => {
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

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

describe("by init edge cases", () => {
  it.each([
    ["BY"],
    ["A1"],
    ["ABC123"],
    ["A123456789"],
  ])("accepts valid task prefix %s", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(true);
  });

  it.each([
    ["B"],
    ["by"],
    ["1BY"],
    ["BY-1"],
    ["A1234567890"],
    [""],
  ])("rejects invalid task prefix %j", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(false);
  });

  it.effect("initializes when .but-why exists without config", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("status: initialized");
      expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
        taskPrefix: "BY",
      });
    }),
  );

  it.effect("fails when the reviewers path is a file", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      writeConfig(root);
      writeFileSync(join(root, ".but-why/reviewers"), "not a directory");
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_repo_state
  message: .but-why/reviewers/ must be a directory.
  path: .but-why/reviewers/
help[1]: Move the conflicting path aside before running init again.
`);
      expect(existsSync(join(root, ".but-why/reviewers"))).toBe(true);
    }),
  );

  it.effect("initializes repository state through the scoped SQL service", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* initRepoLocalContext({ cwd: root, taskPrefix: "BY" });

      expect(result).toMatchObject({ ok: true, status: "initialized" });
      expect(existsSync(join(root, ".git", "but-why", "state.sqlite"))).toBe(true);
    }),
  );

  it.effect("is unchanged when the current state database already exists", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("status: unchanged");
    }),
  );

  it.effect("reports restored retired lifecycle states during init", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const statePath = join(root, ".git", "but-why", "state.sqlite");
      mkdirSync(join(root, ".but-why"), { recursive: true });
      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      writeFileSync(
        join(root, ".but-why/config.json"),
        `${JSON.stringify({ taskPrefix: "BY" }, null, 2)}\n`,
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* migrateThrough22;
          yield* sql`INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at) VALUES ('BY-1', 1, 'Restored Task', 'Retired state.', 'implementing', '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z')`;
        }).pipe(Effect.provide(nodeSqliteLayer(statePath))),
      );

      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: restored_transient_state
  message: Shared But Why? state contains retired lifecycle states.
  tasks[1]{id,numericId,title,state,changeId}:
    BY-1,1,Restored Task,implementing,null
help[1]: "Restore a known-good copy of <git-common-dir>/but-why/state.sqlite, then retry the command."
`);
    }),
  );

  it.effect("reports state_store_unavailable when Shared Repository State cannot be opened", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const statePath = join(root, ".git", "but-why", "state.sqlite");
      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      writeFileSync(statePath, "not sqlite");

      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: state_store_unavailable
  message: Shared But Why? state is unavailable.
help[1]: "Restore <git-common-dir>/but-why/state.sqlite, then run \`by init --task-prefix BY\`."
`);
    }),
  );
});
