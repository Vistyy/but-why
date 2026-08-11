import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangeValidationTestDependencies } from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const reviewerProfile = {
  agentProfile: "test-reviewer",
  scope: "global",
  profile: { agentRuntime: "pi" },
} as const;
const policy = {
  prepare: { command: "prepare", timeoutSeconds: 60 },
  checks: [{ id: "types", command: "typecheck", timeoutSeconds: 60 }],
  copyFiles: [],
  acceptanceReview: {
    instructions: "Review acceptance.",
    instructionsSource: "built_in",
    profile: reviewerProfile,
  },
  specialistReviews: [
    {
      id: "security",
      instructions: "Review security.",
      instructionsSource: "repo",
      profile: reviewerProfile,
    },
  ],
} as const;
const now = "2026-08-10T00:00:00.000Z";

describe("SQLite Candidate and Validation read decoding", () => {
  it.scoped(
    "decodes current Candidate and Validation records through the production Adapters",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const capture = yield* openSqliteCandidateCapturePersistence();
          const validation = yield* openSqliteChangeValidationTestDependencies();
          const repository = yield* RepositorySql;
          const prior = yield* capture.commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/decoding",
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "base",
            headSha: "prior",
            now: "2026-08-10T00:01:00.000Z",
          });
          if (!prior.ok) throw new Error(`Candidate capture failed: ${prior.code}`);
          const priorRun = yield* validation.execution.startOrReuse({
            candidateId: prior.candidateId,
            changeBaseSha: "base",
            headSha: "prior",
            policy,
            now: "2026-08-10T00:03:00.000Z",
          });
          if (priorRun.reused || "blocked" in priorRun) throw new Error("Expected a new Run");
          yield* validation.execution.recordPrepareRound({
            validationRunId: priorRun.validationRunId,
            roundNumber: 1,
            roundStatus: "passed",
            artifactRecords: [],
            now,
          });
          yield* validation.execution.recordCheckRound({
            validationRunId: priorRun.validationRunId,
            producer: "types",
            roundNumber: 1,
            roundStatus: "passed",
            artifactRecords: [],
            now,
          });
          yield* validation.execution.recordAcceptanceRound({
            validationRunId: priorRun.validationRunId,
            roundNumber: 1,
            roundStatus: "failed",
            artifactRecords: [
              {
                ref: "artifact-acceptance",
                validationRunId: priorRun.validationRunId,
                phase: "acceptance_review",
                producer: "acceptance",
                path: "acceptance/stdout.txt",
                originalBytes: 10,
                storedBytes: 7,
                truncated: true,
              },
            ],
            findings: [
              {
                id: "finding-prior",
                validationRunId: priorRun.validationRunId,
                phase: "acceptance_review",
                producer: "acceptance",
                title: "Fix prior issue",
                description: "A prior issue was found.",
                evidence: "Observed in the prior Candidate.",
                files: ["src/prior.ts"],
                artifactRefs: ["artifact-acceptance"],
              },
            ],
            now,
          });
          yield* validation.execution.recordSpecialistRound({
            validationRunId: priorRun.validationRunId,
            producer: "security",
            roundNumber: 1,
            roundStatus: "passed",
            artifactRecords: [],
            findings: [],
            now,
          });
          yield* validation.execution.recordToolingFailure({
            validationRunId: priorRun.validationRunId,
            errorKind: "infrastructure_tooling_failed",
            operationName: "collect advisory evidence",
            errorMessage: "Advisory collection failed.",
            now,
          });
          yield* validation.execution.complete({
            validationRunId: priorRun.validationRunId,
            outcome: "blocked",
            now: "2026-08-10T00:04:00.000Z",
          });

          const current = yield* capture.commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/decoding",
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "base",
            headSha: "current",
            expectedChangeId: prior.changeId,
            now: "2026-08-10T00:04:30.000Z",
          });
          if (!current.ok) throw new Error(`Candidate capture failed: ${current.code}`);

          const active = yield* validation.execution.startOrReuse({
            candidateId: current.candidateId,
            changeBaseSha: "base",
            headSha: "current",
            policy,
            workspaceSetup: { worktreePath: "/tmp/current" },
            now: "2026-08-10T00:05:00.000Z",
          });
          if (active.reused || "blocked" in active) throw new Error("Expected an Active Run");

          expect(yield* validation.reads.getCandidateById(current.candidateId)).toMatchObject({
            id: current.candidateId,
            changeId: current.changeId,
            headSha: "current",
          });
          expect(
            (yield* validation.reads.listCandidatesForChange(current.changeId)).map(
              ({ headSha }) => headSha,
            ),
          ).toEqual(["prior", "current"]);
          expect(yield* validation.reads.getRunById(priorRun.validationRunId)).toMatchObject({
            state: "complete",
            outcome: "blocked",
          });
          expect(yield* validation.active.getActiveForChange(current.changeId)).toEqual({
            validationRunId: active.validationRunId,
            changeId: current.changeId,
          });
          expect(
            yield* validation.abandonment.getAbandonmentContext(active.validationRunId),
          ).toMatchObject({
            validationRunId: active.validationRunId,
            candidateId: current.candidateId,
            worktreePath: "/tmp/current",
            cleanupWorkspace: "not_created",
          });
          expect(
            (yield* validation.reads.listRounds(priorRun.validationRunId)).map(
              ({ phase }) => phase,
            ),
          ).toEqual(["prepare", "checks", "acceptance_review", "specialist_review"]);
          expect(yield* validation.reads.listFindings(priorRun.validationRunId)).toMatchObject([
            { id: "finding-prior", files: ["src/prior.ts"], artifactRefs: ["artifact-acceptance"] },
          ]);
          expect(
            yield* validation.reads.listToolingFailures(priorRun.validationRunId),
          ).toMatchObject([{ sequence: 1, errorKind: "infrastructure_tooling_failed" }]);
          expect(yield* validation.reads.listArtifacts(priorRun.validationRunId)).toMatchObject([
            { ref: "artifact-acceptance", originalBytes: 10, storedBytes: 7, truncated: true },
          ]);
          expect(
            yield* validation.execution.listPreviousCandidateReviewerFindings({
              candidateId: current.candidateId,
              phase: "acceptance_review",
              producer: "acceptance",
            }),
          ).toMatchObject([{ id: "finding-prior" }]);
          expect(yield* validation.artifacts.listRunIdsForChange(current.changeId)).toEqual([
            priorRun.validationRunId,
            active.validationRunId,
          ]);

          yield* repository.operation(
            "install malformed historical Candidate",
            (sql) => sql`UPDATE candidates SET head_sha = X'07' WHERE id = ${prior.candidateId}`,
          );
          expect(
            yield* validation.reads.getCurrentCandidateForChange(current.changeId),
          ).toMatchObject({
            id: current.candidateId,
            headSha: "current",
          });
          yield* repository.operation(
            "restore historical Candidate",
            (sql) => sql`UPDATE candidates SET head_sha = 'prior' WHERE id = ${prior.candidateId}`,
          );

          yield* repository.operation(
            "install opaque malformed Snapshot",
            (sql) =>
              sql`UPDATE candidate_validation_runs SET policy_snapshot = '{not-json' WHERE id = ${priorRun.validationRunId}`,
          );
          expect(yield* validation.artifacts.listRunIdsForChange(current.changeId)).toContain(
            priorRun.validationRunId,
          );
          expect(
            yield* validation.reads.listToolingFailures(priorRun.validationRunId),
          ).toMatchObject([{ sequence: 1, errorKind: "infrastructure_tooling_failed" }]);
          expect(
            yield* validation.reads.getLatestRunForCandidate(current.candidateId),
          ).toMatchObject({ id: active.validationRunId, state: "running" });
          const strictError = yield* validation.reads
            .getRunById(priorRun.validationRunId)
            .pipe(Effect.flip);
          expect(strictError).toBeInstanceOf(RepositoryPersistedDataInvalid);
        }),
      ),
  );

  it.scoped("scopes representative malformed Candidate and Validation facts by operation", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        const repository = yield* RepositorySql;
        const prior = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/malformed-decoding",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base",
          headSha: "prior",
          now: "2026-08-10T01:01:00.000Z",
        });
        if (!prior.ok) throw new Error(`Candidate capture failed: ${prior.code}`);
        const started = yield* validation.execution.startOrReuse({
          candidateId: prior.candidateId,
          changeBaseSha: "base",
          headSha: "prior",
          policy,
          now,
        });
        if (started.reused || "blocked" in started) throw new Error("Expected a new Run");
        yield* validation.execution.recordAcceptanceRound({
          validationRunId: started.validationRunId,
          roundNumber: 1,
          roundStatus: "failed",
          artifactRecords: [
            {
              ref: "artifact-malformed",
              validationRunId: started.validationRunId,
              phase: "acceptance_review",
              producer: "acceptance",
              path: "acceptance/stdout.txt",
              originalBytes: 10,
              storedBytes: 10,
              truncated: false,
            },
          ],
          findings: [
            {
              id: "finding-malformed",
              validationRunId: started.validationRunId,
              phase: "acceptance_review",
              producer: "acceptance",
              title: "Prior finding",
              description: "Prior finding description.",
              evidence: "Prior evidence.",
              files: ["src/file.ts"],
              artifactRefs: ["artifact-malformed"],
            },
          ],
          now,
        });
        yield* validation.execution.recordCheckRound({
          validationRunId: started.validationRunId,
          producer: "types",
          roundNumber: 1,
          roundStatus: "passed",
          artifactRecords: [],
          now,
        });
        yield* validation.execution.complete({
          validationRunId: started.validationRunId,
          outcome: "blocked",
          now,
        });

        const current = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/malformed-decoding",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base",
          headSha: "current",
          expectedChangeId: prior.changeId,
          now: "2026-08-10T01:02:00.000Z",
        });
        if (!current.ok) throw new Error(`Candidate capture failed: ${current.code}`);

        yield* repository.operation("install orphan Tooling Failure", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA foreign_keys = OFF`;
            yield* sql`INSERT INTO candidate_validation_tooling_failures (validation_run_id, error_kind, operation_name, error_message, created_at) VALUES ('unknown-run', 'infrastructure_tooling_failed', 'orphan operation', 'orphan failure', ${now})`;
            yield* sql`PRAGMA foreign_keys = ON`;
          }),
        );
        expect(
          yield* validation.reads.listToolingFailures("unknown-run").pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "remove orphan Tooling Failure",
          (sql) =>
            sql`DELETE FROM candidate_validation_tooling_failures WHERE validation_run_id = 'unknown-run'`,
        );

        yield* repository.operation(
          "install wrong Candidate scalar",
          (sql) => sql`UPDATE candidates SET head_sha = X'07' WHERE id = ${prior.candidateId}`,
        );
        expect(
          yield* capture.commitCapture({
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/malformed-decoding",
            baseRef: "refs/remotes/origin/main",
            changeBaseSha: "base",
            headSha: "current",
            expectedChangeId: prior.changeId,
            now,
          }),
        ).toMatchObject({ ok: true, candidateId: current.candidateId, reused: true });
        yield* repository.operation(
          "restore Candidate scalar",
          (sql) => sql`UPDATE candidates SET head_sha = 'prior' WHERE id = ${prior.candidateId}`,
        );

        yield* repository.operation("install invalid Validation Run lifecycle", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`UPDATE candidate_validation_runs SET state = 'running', outcome = 'passed' WHERE id = ${started.validationRunId}`;
          }),
        );
        expect(
          yield* validation.reads.getRunById(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation("restore Validation Run lifecycle", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE candidate_validation_runs SET state = 'complete', outcome = 'blocked' WHERE id = ${started.validationRunId}`;
            yield* sql`PRAGMA ignore_check_constraints = OFF`;
          }),
        );

        yield* repository.operation("install resolved Blocker history", (sql) =>
          Effect.gen(function* () {
            yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content, resolved_at, resolution_id, resolution_recorded_at, resolution_content) VALUES ('older-blocker', ${prior.changeId}, '2026-08-09T22:00:00.000Z', 'Older blocker.', '2026-08-09T22:01:00.000Z', 'older-resolution', '2026-08-09T22:01:00.000Z', 'Older resolution.')`;
            yield* sql`INSERT INTO implementation_blockers (id, change_id, reported_at, content, resolved_at, resolution_id, resolution_recorded_at, resolution_content) VALUES ('latest-blocker', ${prior.changeId}, '2026-08-09T23:00:00.000Z', 'Latest blocker.', '2026-08-09T23:01:00.000Z', 'latest-resolution', '2026-08-09T23:01:00.000Z', 'Latest resolution.')`;
          }),
        );
        expect(
          yield* validation.reads.getRunById(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "install older Blocker identity",
          (sql) =>
            sql`UPDATE candidate_validation_runs SET latest_resolved_blocker_id = 'older-blocker' WHERE id = ${started.validationRunId}`,
        );
        expect(
          yield* validation.reads.getRunById(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "install exact latest Blocker identity",
          (sql) =>
            sql`UPDATE candidate_validation_runs SET latest_resolved_blocker_id = 'latest-blocker' WHERE id = ${started.validationRunId}`,
        );
        expect(yield* validation.reads.getRunById(started.validationRunId)).toBeDefined();
        yield* repository.operation("restore absent Blocker history", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE candidate_validation_runs SET latest_resolved_blocker_id = NULL WHERE id = ${started.validationRunId}`;
            yield* sql`DELETE FROM implementation_blockers WHERE change_id = ${prior.changeId}`;
          }),
        );

        yield* repository.operation(
          "install malformed Finding files",
          (sql) =>
            sql`UPDATE candidate_validation_findings SET files = '["src/file.ts",]' WHERE id = 'finding-malformed'`,
        );
        expect(
          yield* validation.reads.listFindings(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "restore Finding files",
          (sql) =>
            sql`UPDATE candidate_validation_findings SET files = '["src/file.ts"]' WHERE id = 'finding-malformed'`,
        );

        yield* repository.operation(
          "install unsafe Artifact number",
          (sql) =>
            sql`UPDATE candidate_validation_artifacts SET original_bytes = 9007199254740992, stored_bytes = 10, truncated = 1 WHERE ref = 'artifact-malformed'`,
        );
        expect(
          yield* validation.reads.listArtifacts(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "install invalid Artifact relationship",
          (sql) =>
            sql`UPDATE candidate_validation_artifacts SET original_bytes = 9, stored_bytes = 10, truncated = 0 WHERE ref = 'artifact-malformed'`,
        );
        expect(
          yield* validation.reads.listArtifacts(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation("install invalid Artifact flag", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`UPDATE candidate_validation_artifacts SET original_bytes = 10, stored_bytes = 10, truncated = 2 WHERE ref = 'artifact-malformed'`;
          }),
        );
        expect(
          yield* validation.reads.listArtifacts(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation("restore Artifact", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE candidate_validation_artifacts SET original_bytes = 10, stored_bytes = 10, truncated = 0 WHERE ref = 'artifact-malformed'`;
            yield* sql`PRAGMA ignore_check_constraints = OFF`;
          }),
        );

        yield* repository.operation(
          "detach Artifact from its Validation round",
          (sql) =>
            sql`UPDATE candidate_validation_artifacts SET phase = 'checks', producer = 'retired-check' WHERE ref = 'artifact-malformed'`,
        );
        expect(
          yield* validation.reads.listArtifacts(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "restore Artifact round relationship",
          (sql) =>
            sql`UPDATE candidate_validation_artifacts SET phase = 'acceptance_review', producer = 'acceptance' WHERE ref = 'artifact-malformed'`,
        );

        yield* repository.operation(
          "install Finding without a related round",
          (sql) =>
            sql`UPDATE candidate_validation_findings SET phase = 'checks', producer = 'types' WHERE id = 'finding-malformed'`,
        );
        expect(
          yield* validation.reads.listFindings(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* validation.execution.listPreviousCandidateReviewerFindings({
            candidateId: current.candidateId,
            phase: "acceptance_review",
            producer: "acceptance",
          }),
        ).toEqual([]);
        yield* repository.operation(
          "restore Finding relationship",
          (sql) =>
            sql`UPDATE candidate_validation_findings SET phase = 'acceptance_review', producer = 'acceptance' WHERE id = 'finding-malformed'`,
        );

        yield* repository.operation(
          "attach Finding to passed round",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET status = 'passed' WHERE validation_run_id = ${started.validationRunId} AND phase = 'acceptance_review'`,
        );
        expect(
          yield* validation.reads.listFindings(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* validation.execution
            .listPreviousCandidateReviewerFindings({
              candidateId: current.candidateId,
              phase: "acceptance_review",
              producer: "acceptance",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "restore failed Finding round",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET status = 'failed' WHERE validation_run_id = ${started.validationRunId} AND phase = 'acceptance_review'`,
        );

        yield* repository.operation(
          "install unconfigured Check producer",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET producer = 'retired-check' WHERE validation_run_id = ${started.validationRunId} AND phase = 'checks'`,
        );
        expect(
          yield* validation.reads.listRounds(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(yield* validation.reads.listFindings(started.validationRunId)).toMatchObject([
          { id: "finding-malformed" },
        ]);
        expect(yield* validation.reads.listArtifacts(started.validationRunId)).toMatchObject([
          { ref: "artifact-malformed" },
        ]);
        expect(
          yield* validation.execution.listPreviousCandidateReviewerFindings({
            candidateId: current.candidateId,
            phase: "acceptance_review",
            producer: "acceptance",
          }),
        ).toMatchObject([{ id: "finding-malformed" }]);
        yield* repository.operation(
          "restore Check producer",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET producer = 'types' WHERE validation_run_id = ${started.validationRunId} AND phase = 'checks'`,
        );

        yield* repository.operation(
          "install incorrectly ordered Check round",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET round_number = 2 WHERE validation_run_id = ${started.validationRunId} AND phase = 'checks'`,
        );
        expect(
          yield* validation.reads.listRounds(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "restore Check round order",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET round_number = 1 WHERE validation_run_id = ${started.validationRunId} AND phase = 'checks'`,
        );

        yield* repository.operation(
          "install duplicate Acceptance Review round",
          (sql) =>
            sql`INSERT INTO candidate_validation_rounds (validation_run_id, phase, producer, round_number, status, created_at) VALUES (${started.validationRunId}, 'acceptance_review', 'acceptance', 2, 'failed', ${now})`,
        );
        expect(
          yield* validation.reads.listFindings(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* repository.operation(
          "remove duplicate Acceptance Review round",
          (sql) =>
            sql`DELETE FROM candidate_validation_rounds WHERE validation_run_id = ${started.validationRunId} AND phase = 'acceptance_review' AND round_number = 2`,
        );

        yield* repository.operation(
          "install malformed skipped history round",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET phase = 'retired_phase' WHERE validation_run_id = ${started.validationRunId}`,
        );
        expect(
          yield* validation.execution.listPreviousCandidateReviewerFindings({
            candidateId: current.candidateId,
            phase: "acceptance_review",
            producer: "acceptance",
          }),
        ).toEqual([]);
        yield* repository.operation(
          "restore history round",
          (sql) =>
            sql`UPDATE candidate_validation_rounds SET phase = 'acceptance_review' WHERE validation_run_id = ${started.validationRunId}`,
        );

        yield* repository.operation("install foreign Candidate relationship", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA foreign_keys = OFF`;
            yield* sql`UPDATE candidates SET change_id = 'foreign-change' WHERE id = ${prior.candidateId}`;
            yield* sql`PRAGMA foreign_keys = ON`;
          }),
        );
        expect(
          yield* validation.reads.getCandidateById(prior.candidateId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );
});
