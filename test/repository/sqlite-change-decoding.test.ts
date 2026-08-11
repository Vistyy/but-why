import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
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
        const changes = yield* openSqliteChangeTestDependencies();
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

        const stored = yield* changes.reads.getChangeById("change-decoded");
        expect(stored?.acceptanceContext).toEqual({
          version: 1,
          title: "Historical intent",
          description: "Preserve snapshots.",
          comments: ["first\ncomment", "second"],
          resolutions: ["keep  spacing"],
        });
      }),
    ),
  );

  it.scoped("scopes malformed Change relationship decoding", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
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
        expect(yield* changes.reads.getChangeById("change-malformed")).toMatchObject({
          taskId: null,
          startingCommit: null,
        });
        yield* expectPersistedDataInvalid(starts.getById("change-malformed"));
        yield* repository.operation(
          "restore Change Start",
          (sql) =>
            sql`UPDATE changes SET starting_commit = 'base-sha' WHERE id = 'change-malformed'`,
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
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
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
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        const publicationAuthority = {
          changeBaseSha: "base-sha",
          policy: { checks: [], copyFiles: [], specialistReviews: [] },
          implementationDecisions: [],
        };
        yield* repository.operation(
          "inject malformed publication snapshots",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET state = 'complete', policy_snapshot = '{"checks":"invalid"}'
            WHERE id = 'owned-run'
          `,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationAuthority,
          ),
        ).toBeUndefined();
        yield* repository.operation(
          "inject malformed Implementation Decision Snapshot",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET policy_snapshot = '{"checks":[],"copyFiles":[],"specialistReviews":[]}',
              implementation_decisions = '{}'
            WHERE id = 'owned-run'
          `,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationAuthority,
          ),
        ).toBeUndefined();
        yield* repository.operation(
          "inject foreign publication Implementation Decision",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET implementation_decisions = '[{"id":"decision-1","changeId":"change-publication-owner","sequence":1,"recordedAt":"2026-08-09T20:10:00.000Z","choice":"Foreign choice","rationale":"Foreign rationale"}]'
            WHERE id = 'owned-run'
          `,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationAuthority,
          ),
        ).toBeUndefined();
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
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationAuthority,
          ),
        ).toBeUndefined();
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
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        yield* repository.operation(
          "install malformed Acceptance Context resolutions",
          (sql) => sql`
            UPDATE changes SET acceptance_context =
              '{"version":1,"title":"Malformed intent","description":"Reject it.","resolutions":"not-an-array"}'
            WHERE id = 'change-malformed'
          `,
        );
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        yield* repository.operation(
          "restore taskless context",
          (sql) =>
            sql`UPDATE changes SET task_id = NULL, acceptance_context = NULL WHERE id = 'change-malformed'`,
        );
      }),
    ),
  );
});
