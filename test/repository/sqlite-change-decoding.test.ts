import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteChangeTestPorts } from "../support/changePorts.js";
import { openSqliteChangeValidationTestPorts } from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const expectPersistedDataInvalid = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const error = yield* effect.pipe(Effect.flip);
    expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
  });

describe("SQLite Change decoding", () => {
  it.scoped("round-trips taskless Change Start data and historical snapshot arrays exactly", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestPorts();
        const repository = yield* RepositorySql;
        const created = yield* starts.create({
          id: "change-decoded",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-decoded",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-decoded`,
          prepare: { command: "just init", timeoutSeconds: 120 },
          now: "2026-08-09T20:00:00.000Z",
        });
        expect(created).toMatchObject({ ok: true, change: { taskId: null } });

        yield* repository.operation("install historical Acceptance Context", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
              ) VALUES (
                'BY-901', 901, 'Historical intent', 'Preserve snapshots.', 'todo', NULL,
                '2026-08-09T20:00:00.000Z', '2026-08-09T20:00:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes
              SET task_id = 'BY-901', acceptance_context =
                '{"version":1,"title":"Historical intent","description":"Preserve snapshots.","comments":["first\\ncomment","second"],"resolutions":["keep  spacing"]}'
              WHERE id = 'change-decoded'
            `;
          }),
        );

        const stored = yield* changes.getChangeById("change-decoded");
        expect(stored?.acceptanceContext).toEqual({
          version: 1,
          title: "Historical intent",
          description: "Preserve snapshots.",
          comments: ["first\ncomment", "second"],
          resolutions: ["keep  spacing"],
        });
        yield* repository.operation(
          "inject incomplete task-backed Change Start",
          (sql) => sql`UPDATE changes SET starting_commit = NULL WHERE id = 'change-decoded'`,
        );
        yield* expectPersistedDataInvalid(changes.getChangeById("change-decoded"));
      }),
    ),
  );

  it.scoped("rejects malformed Change relationships before filtering or selection", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestPorts();
        const repository = yield* RepositorySql;
        const created = yield* starts.create({
          id: "change-malformed",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-malformed",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-malformed`,
          now: "2026-08-09T20:10:00.000Z",
        });
        if (!created.ok) throw new Error(created.code);

        yield* repository.operation(
          "inject incomplete Change Start",
          (sql) => sql`UPDATE changes SET starting_commit = NULL WHERE id = 'change-malformed'`,
        );
        expect(yield* changes.getChangeById("change-malformed")).toMatchObject({
          taskId: null,
          startingCommit: null,
        });
        yield* expectPersistedDataInvalid(starts.getById("change-malformed"));
        yield* repository.operation(
          "restore Change Start",
          (sql) =>
            sql`UPDATE changes SET starting_commit = 'base-sha' WHERE id = 'change-malformed'`,
        );

        const corruptAndReject = (
          label: string,
          update: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError>,
          read: Effect.Effect<unknown, unknown> = changes.getChangeById("change-malformed"),
        ) =>
          Effect.gen(function* () {
            yield* repository.operation(`inject ${label}`, (sql) => Effect.asVoid(update(sql)));
            yield* expectPersistedDataInvalid(read);
          });

        yield* corruptAndReject(
          "incomplete preparation",
          (sql) =>
            sql`UPDATE changes SET prepare_command = 'just init' WHERE id = 'change-malformed'`,
        );
        yield* repository.operation(
          "restore preparation",
          (sql) => sql`UPDATE changes SET prepare_command = NULL WHERE id = 'change-malformed'`,
        );

        yield* corruptAndReject(
          "incomplete publication",
          (sql) =>
            sql`UPDATE changes SET publication_candidate_id = 'candidate' WHERE id = 'change-malformed'`,
        );
        yield* repository.operation(
          "restore publication",
          (sql) =>
            sql`UPDATE changes SET publication_candidate_id = NULL WHERE id = 'change-malformed'`,
        );

        const other = yield* starts.create({
          id: "change-publication-owner",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-publication-owner",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-publication-owner`,
          now: "2026-08-09T20:10:00.000Z",
        });
        if (!other.ok) throw new Error(other.code);
        yield* repository.operation("inject foreign publication ownership", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
              VALUES (
                'foreign-candidate', 'change-publication-owner', 'base-sha', 'head-sha',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'foreign-run', 'foreign-candidate',
                '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]',
                NULL, 'complete', 'passed', '2026-08-09T20:10:00.000Z',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = 'foreign-candidate',
                publication_validation_run_id = 'foreign-run', publication_owner = 'acme',
                publication_repo = 'repo', publication_base_branch = 'main',
                publication_remote_name = 'origin', publication_head_branch = 'foreign',
                publication_expected_head_sha = 'head-sha'
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.getChangeById("change-malformed"));
        yield* expectPersistedDataInvalid(starts.getById("change-malformed"));

        yield* repository.operation("inject malformed publication evidence relationships", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
              VALUES (
                'owned-candidate', 'change-malformed', 'base-sha', 'actual-head',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'owned-run', 'owned-candidate',
                '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
                'complete', 'passed', '2026-08-09T20:10:00.000Z',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO candidate_validation_admissions (candidate_id, validation_run_id)
              VALUES ('owned-candidate', 'owned-run')
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = 'owned-candidate',
                publication_validation_run_id = 'owned-run', publication_owner = 'acme',
                publication_repo = 'repo', publication_base_branch = 'main',
                publication_remote_name = 'origin', publication_head_branch = 'owned',
                publication_expected_head_sha = 'different-head', publication_pr_number = 7,
                publication_pr_url = 'https://github.test/pull/7'
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.getChangeById("change-malformed"));
        yield* repository.operation("inject unsupported publication Run state", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE changes SET publication_expected_head_sha = 'actual-head' WHERE id = 'change-malformed'`;
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`UPDATE candidate_validation_runs SET state = 'corrupt' WHERE id = 'owned-run'`;
          }),
        );
        const publicationAuthority = {
          changeBaseSha: "base-sha",
          policy: { checks: [], copyFiles: [], specialistReviews: [] },
          implementationDecisions: [],
        };
        yield* expectPersistedDataInvalid(
          changes.getCurrentPassingEvidence("change-malformed", publicationAuthority),
        );
        yield* repository.operation(
          "inject malformed publication snapshots",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET state = 'complete', policy_snapshot = '{"checks":"invalid"}'
            WHERE id = 'owned-run'
          `,
        );
        yield* expectPersistedDataInvalid(
          changes.getCurrentPassingEvidence("change-malformed", publicationAuthority),
        );
        yield* repository.operation(
          "inject malformed Implementation Decision Snapshot",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET policy_snapshot = '{"checks":[],"copyFiles":[],"specialistReviews":[]}',
              implementation_decisions = '{}'
            WHERE id = 'owned-run'
          `,
        );
        yield* expectPersistedDataInvalid(
          changes.getCurrentPassingEvidence("change-malformed", publicationAuthority),
        );
        yield* repository.operation(
          "inject foreign publication Implementation Decision",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET implementation_decisions = '[{"id":"decision-1","changeId":"change-publication-owner","sequence":1,"recordedAt":"2026-08-09T20:10:00.000Z","choice":"Foreign choice","rationale":"Foreign rationale"}]'
            WHERE id = 'owned-run'
          `,
        );
        yield* expectPersistedDataInvalid(
          changes.getCurrentPassingEvidence("change-malformed", publicationAuthority),
        );
        yield* repository.operation("inject foreign latest resolved Blocker", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE candidate_validation_runs SET implementation_decisions = '[]' WHERE id = 'owned-run'`;
            yield* sql`
              INSERT INTO implementation_blockers (
                id, change_id, reported_at, content, resolved_at, resolution_id,
                resolution_recorded_at, resolution_content
              ) VALUES (
                'foreign-blocker', 'change-publication-owner',
                '2026-08-09T20:10:00.000Z', 'Foreign blocker.',
                '2026-08-09T20:10:01.000Z', 'foreign-resolution',
                '2026-08-09T20:10:01.000Z', 'Resolved elsewhere.'
              )
            `;
            yield* sql`
              UPDATE candidate_validation_runs
              SET latest_resolved_blocker_id = 'foreign-blocker'
              WHERE id = 'owned-run'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(
          changes.getCurrentPassingEvidence("change-malformed", publicationAuthority),
        );
        yield* repository.operation(
          "restore absent publication",
          (sql) => sql`
            UPDATE changes SET
              publication_candidate_id = NULL, publication_validation_run_id = NULL,
              publication_owner = NULL, publication_repo = NULL, publication_base_branch = NULL,
              publication_remote_name = NULL, publication_head_branch = NULL,
              publication_expected_head_sha = NULL, publication_pr_number = NULL,
              publication_pr_url = NULL
            WHERE id = 'change-malformed'
          `,
        );

        yield* repository.operation("install unsupported Acceptance Context shape", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
              ) VALUES (
                'BY-902', 902, 'Malformed intent', 'Reject it.', 'todo', NULL,
                '2026-08-09T20:10:00.000Z', '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET task_id = 'BY-902', acceptance_context =
                '{"version":1,"title":"Malformed intent","description":"Reject it.","unexpected":true}'
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.getChangeById("change-malformed"));
        yield* repository.operation(
          "install malformed Acceptance Context resolutions",
          (sql) => sql`
            UPDATE changes SET acceptance_context =
              '{"version":1,"title":"Malformed intent","description":"Reject it.","resolutions":"not-an-array"}'
            WHERE id = 'change-malformed'
          `,
        );
        yield* expectPersistedDataInvalid(changes.getChangeById("change-malformed"));
        yield* repository.operation(
          "restore taskless context",
          (sql) =>
            sql`UPDATE changes SET task_id = NULL, acceptance_context = NULL WHERE id = 'change-malformed'`,
        );

        yield* repository.operation(
          "inject open Change terminal cleanup",
          (sql) => sql`UPDATE changes SET cleanup_state = 'pending' WHERE id = 'change-malformed'`,
        );
        yield* expectPersistedDataInvalid(
          changes.listChangesForReconciliation(input.commonDirectory),
        );
        yield* repository.operation(
          "restore open Change cleanup",
          (sql) => sql`UPDATE changes SET cleanup_state = 'complete' WHERE id = 'change-malformed'`,
        );

        yield* repository.operation("inject hidden lifecycle corruption", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`
              UPDATE changes SET state = 'closed', close_reason = NULL, closed_at = NULL
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(
          changes.listChanges({
            repositoryCommonDirectory: input.commonDirectory,
            includeClosed: false,
          }),
        );
      }),
    ),
  );

  it.scoped("rejects partial blocker resolution and malformed Change-shaped capture rows", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestPorts();
        const validation = yield* openSqliteChangeValidationTestPorts();
        const repository = yield* RepositorySql;
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/capture-decoding",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-08-09T20:20:00.000Z",
        });
        if (!captured.ok) throw new Error(captured.code);
        const raised = yield* changes.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Need authority.",
          now: "2026-08-09T20:21:00.000Z",
        });
        if (!raised.ok) throw new Error(raised.code);

        yield* repository.operation(
          "inject partial blocker resolution",
          (sql) =>
            sql`
            UPDATE implementation_blockers
            SET resolved_at = '2026-08-09T20:22:00.000Z', resolution_id = 'resolution-1'
            WHERE id = ${raised.blocker.id}
          `,
        );
        yield* expectPersistedDataInvalid(changes.listImplementationBlockers(captured.changeId));
        yield* expectPersistedDataInvalid(
          validation.startOrReuse({
            candidateId: captured.candidateId,
            changeBaseSha: "base-sha",
            headSha: "head-sha",
            policy: { checks: [], copyFiles: [], specialistReviews: [] },
            now: "2026-08-09T20:22:00.000Z",
          }),
        );

        yield* repository.operation(
          "complete first blocker resolution",
          (sql) =>
            sql`
            UPDATE implementation_blockers
            SET resolution_recorded_at = '2026-08-09T20:22:00.000Z',
              resolution_content = 'Proceed.'
            WHERE id = ${raised.blocker.id}
          `,
        );
        const second = yield* changes.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Need another decision.",
          now: "2026-08-09T20:23:00.000Z",
        });
        if (!second.ok) throw new Error(second.code);
        const secondResolution = yield* changes.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed again.",
          now: "2026-08-09T20:24:00.000Z",
        });
        if (!secondResolution.ok) throw new Error(secondResolution.code);
        yield* repository.operation(
          "make a Resolution belong to two Blockers",
          (sql) =>
            sql`
            UPDATE implementation_blockers SET resolution_id = 'resolution-1'
            WHERE id = ${second.blocker.id}
          `,
        );
        yield* expectPersistedDataInvalid(changes.listImplementationBlockers(captured.changeId));

        yield* repository.operation("inject malformed capture lifecycle", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`UPDATE changes SET state = 'retired' WHERE id = ${captured.changeId}`;
          }),
        );
        yield* expectPersistedDataInvalid(capture.getChangeById(captured.changeId));
      }),
    ),
  );
});
