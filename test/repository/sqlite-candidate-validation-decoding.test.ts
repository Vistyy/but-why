import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/repositoryRuntime/adapters/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const policy = {
  prepare: { command: "pnpm install", timeoutSeconds: 60 },
  checks: [{ id: "types", command: "pnpm typecheck", timeoutSeconds: 30 }],
} as const;
const now = "2026-08-10T00:00:00.000Z";

const createCandidateOwningChange = (branchRef: string) =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    const rows = yield* repository.operation(
      "create Candidate-owning Change",
      (sql) => sql<{ readonly id: number }>`
        INSERT INTO changes (
          branch_ref, base_ref, base_remote_url, worktree_path,
          reviewer_configuration, prepare_definition, checks_definition, cleanup_pending
        ) VALUES (
          ${branchRef}, 'refs/remotes/origin/main',
          'https://example.com/acme/repo.git', ${`/tmp/${branchRef.slice("refs/heads/".length)}`},
          '{"acceptanceReview":null,"specialistReviews":[]}',
          ${JSON.stringify(policy.prepare)}, ${JSON.stringify(policy.checks)}, 0
        )
        RETURNING id
      `,
    );
    const changeId = rows[0]?.id;
    if (changeId === undefined) throw new Error("Change identity was not allocated");
    return changeId;
  });

const createRun = (commonDirectory: string, branchRef: string) =>
  Effect.gen(function* () {
    yield* createCandidateOwningChange(branchRef);
    const capture = yield* openSqliteCandidateCapturePersistence();
    const validation = yield* openSqliteChangeValidationTestDependencies();
    const captured = yield* capture.commitCapture({
      repositoryCommonDirectory: commonDirectory,
      branchRef,
      baseRef: "refs/remotes/origin/main",
      changeBaseSha: "base",
      headSha: "head",
    });
    if (!captured.ok) throw new Error(captured.code);
    const started = yield* validation.execution.startOrReuse({
      candidateId: captured.candidateId,
      changeBaseSha: "base",
      headSha: "head",
    });
    if (started.reused || "blocked" in started || "active" in started) {
      throw new Error("Expected a new Validation Run");
    }
    return { captured, started, validation };
  });

const expectInvalidRunAuthority = (
  changeId: string,
  candidateId: number,
  validationRunId: number,
  validation: ChangeValidationTestDependencies,
  startOutcome: "invalid" | "blocked",
) =>
  Effect.gen(function* () {
    expect(yield* validation.reads.getRunById(validationRunId).pipe(Effect.flip)).toBeInstanceOf(
      RepositoryPersistedDataInvalid,
    );
    if (startOutcome === "invalid") {
      expect(
        yield* validation.execution
          .startOrReuse({
            candidateId,
            changeBaseSha: "base",
            headSha: "head",
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);
    } else {
      expect(
        yield* validation.execution.startOrReuse({
          candidateId,
          changeBaseSha: "base",
          headSha: "head",
        }),
      ).toEqual({ reused: false, blocked: true });
    }

    const changes = yield* openSqliteChangeTestDependencies();
    expect(
      yield* changes.publication.getCurrentPassingEvidence(changeId).pipe(Effect.flip),
    ).toBeInstanceOf(RepositoryPersistedDataInvalid);
    expect(
      yield* changes.publication
        .beginPublication({
          changeId,
          candidateId,
          validationRunId,
          target: {
            owner: "acme",
            repo: "widgets",
            baseBranch: "main",
            remoteName: "origin",
          },
          headBranch: "authority-boundary",
          expectedHeadSha: "head",
          now,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(RepositoryPersistedDataInvalid);
  });

describe("SQLite Candidate and Validation read decoding", () => {
  it.scoped("decodes compact Candidate, Validation Run, and phase evidence records", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { captured, started, validation } = yield* createRun(
          input.commonDirectory,
          "refs/heads/decoding",
        );
        yield* validation.execution.recordPrepareResult({
          validationRunId: started.validationRunId,
          outcome: "passed",
          artifactRecords: [],
        });
        yield* validation.execution.recordCheckResult({
          validationRunId: started.validationRunId,
          producer: "types",
          outcome: "failed",
          finding: {
            validationRunId: started.validationRunId,
            phase: "checks",
            producer: "types",
            title: "Fix the issue",
            description: "The Candidate has an issue.",
            evidence: "Observed in the Candidate.",
            files: ["src/main.ts"],
            artifactRefs: ["artifact:1/checks/types/stdout.txt"],
          },
          artifactRecords: [
            {
              ref: "artifact:1/checks/types/stdout.txt",
              validationRunId: started.validationRunId,
              phase: "checks",
              producer: "types",
              path: "1/checks/types/stdout.txt",
              originalBytes: 10,
              storedBytes: 7,
              truncated: true,
            },
          ],
        });
        yield* validation.execution.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* validation.execution.complete({
          validationRunId: started.validationRunId,
          outcome: "blocked",
        });

        expect(yield* validation.reads.getCandidateById(captured.candidateId)).toMatchObject({
          id: captured.candidateId,
          changeId: captured.changeId,
          changeBaseSha: "base",
          headSha: "head",
        });
        expect(yield* validation.reads.getRunById(started.validationRunId)).toMatchObject({
          id: started.validationRunId,
          candidateId: captured.candidateId,
          state: "complete",
          outcome: "blocked",
        });
        expect(yield* validation.reads.listFindings(started.validationRunId)).toMatchObject([
          { title: "Fix the issue", files: ["src/main.ts"] },
        ]);
        expect(yield* validation.reads.listArtifacts(started.validationRunId)).toMatchObject([
          { originalBytes: 10, storedBytes: 7, truncated: true },
        ]);
      }),
    ),
  );

  it.scoped("rejects invalid Validation Run authority boundaries across all consumers", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { captured, started, validation } = yield* createRun(
          input.commonDirectory,
          "refs/heads/authority-boundary",
        );
        yield* validation.execution.recordPrepareResult({
          validationRunId: started.validationRunId,
          outcome: "passed",
          artifactRecords: [],
        });
        yield* validation.execution.recordCheckResult({
          validationRunId: started.validationRunId,
          producer: "types",
          outcome: "passed",
          artifactRecords: [],
        });
        yield* validation.execution.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* validation.execution.complete({
          validationRunId: started.validationRunId,
          outcome: "passed",
        });

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "corrupt completed Validation Run cleanup obligation",
          (sql) => sql`
            UPDATE validation_runs SET cleanup_pending = 1
            WHERE id = ${started.validationRunId}
          `,
        );
        yield* expectInvalidRunAuthority(
          captured.changeId,
          captured.candidateId,
          started.validationRunId,
          validation,
          "invalid",
        );
        yield* repository.operation(
          "restore completed Validation Run cleanup obligation",
          (sql) => sql`
            UPDATE validation_runs SET cleanup_pending = 0
            WHERE id = ${started.validationRunId}
          `,
        );

        const otherChangeId = yield* createCandidateOwningChange(
          "refs/heads/other-authority-boundary",
        );
        const decisionRows = yield* repository.operation(
          "create foreign Validation Run Decision boundary",
          (sql) => sql<{ readonly id: number }>`
            INSERT INTO implementation_decisions (change_id, choice, rationale)
            VALUES (${otherChangeId}, 'Foreign decision', 'Belongs to another Change.')
            RETURNING id
          `,
        );
        const foreignDecisionId = decisionRows[0]?.id;
        if (foreignDecisionId === undefined) throw new Error("Decision identity was not allocated");
        yield* repository.operation(
          "bind foreign Validation Run Decision boundary",
          (sql) => sql`
            UPDATE validation_runs
            SET highest_decision_id = ${foreignDecisionId}
            WHERE id = ${started.validationRunId}
          `,
        );
        yield* expectInvalidRunAuthority(
          captured.changeId,
          captured.candidateId,
          started.validationRunId,
          validation,
          "invalid",
        );

        const foreignBlockerRows = yield* repository.operation(
          "create foreign Validation Run Blocker boundary",
          (sql) => sql<{ readonly id: number }>`
            INSERT INTO implementation_blockers (change_id, content, resolution_content)
            VALUES (${otherChangeId}, 'Foreign blocker', 'Resolved elsewhere.')
            RETURNING id
          `,
        );
        const foreignBlockerId = foreignBlockerRows[0]?.id;
        if (foreignBlockerId === undefined) throw new Error("Blocker identity was not allocated");
        yield* repository.operation(
          "bind foreign Validation Run Blocker boundary",
          (sql) => sql`
            UPDATE validation_runs
            SET highest_decision_id = NULL, highest_blocker_id = ${foreignBlockerId}
            WHERE id = ${started.validationRunId}
          `,
        );
        yield* expectInvalidRunAuthority(
          captured.changeId,
          captured.candidateId,
          started.validationRunId,
          validation,
          "invalid",
        );

        const forgedPolicy = JSON.stringify({
          ...policy,
          acceptanceContext: {
            version: 1,
            title: "Foreign Acceptance Context",
            description: "This Change has no accepted implementation intent.",
          },
        });
        yield* repository.operation(
          "forge Validation Run Acceptance Context",
          (sql) => sql`
            UPDATE validation_runs
            SET highest_blocker_id = NULL, validation_input_snapshot = ${forgedPolicy}
            WHERE id = ${started.validationRunId}
          `,
        );
        yield* expectInvalidRunAuthority(
          captured.changeId,
          captured.candidateId,
          started.validationRunId,
          validation,
          "invalid",
        );

        const unresolvedBlockerRows = yield* repository.operation(
          "create unresolved Validation Run Blocker boundary",
          (sql) => sql<{ readonly id: number }>`
            INSERT INTO implementation_blockers (change_id, content, resolution_content)
            VALUES (
              (SELECT change_id FROM candidates WHERE id = ${captured.candidateId}),
              'Unresolved blocker', NULL
            )
            RETURNING id
          `,
        );
        const unresolvedBlockerId = unresolvedBlockerRows[0]?.id;
        if (unresolvedBlockerId === undefined)
          throw new Error("Blocker identity was not allocated");
        yield* repository.operation(
          "bind unresolved Validation Run Blocker boundary",
          (sql) => sql`
            UPDATE validation_runs
            SET highest_blocker_id = ${unresolvedBlockerId},
              validation_input_snapshot = ${JSON.stringify(policy)}
            WHERE id = ${started.validationRunId}
          `,
        );
        yield* expectInvalidRunAuthority(
          captured.changeId,
          captured.candidateId,
          started.validationRunId,
          validation,
          "blocked",
        );
      }),
    ),
  );

  it.scoped("rejects malformed compact phase evidence at the SQLite boundary", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { started, validation } = yield* createRun(
          input.commonDirectory,
          "refs/heads/malformed-decoding",
        );
        yield* validation.execution.recordCheckResult({
          validationRunId: started.validationRunId,
          producer: "types",
          outcome: "failed",
          finding: {
            validationRunId: started.validationRunId,
            phase: "checks",
            producer: "types",
            title: "Types failed",
            description: "Type checking failed.",
            evidence: "Exit code 1.",
            files: [],
            artifactRefs: [],
          },
          artifactRecords: [],
        });
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "corrupt compact Finding evidence",
          (sql) => sql`
          UPDATE validation_phase_results
          SET findings = '[{"title":]'
          WHERE validation_run_id = ${started.validationRunId}
            AND phase = 'checks' AND producer = 'types'
        `,
        );

        expect(
          yield* validation.reads.listFindings(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        yield* repository.operation(
          "corrupt compact phase Tooling Failure",
          (sql) => sql`
            UPDATE validation_phase_results
            SET findings = '[]', tooling_failure = '{"errorKind":}'
            WHERE validation_run_id = ${started.validationRunId}
              AND phase = 'checks' AND producer = 'types'
          `,
        );
        expect(
          yield* validation.reads.listToolingFailures(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        yield* repository.operation(
          "corrupt singleton phase producer",
          (sql) => sql`
            UPDATE validation_phase_results
            SET phase = 'prepare', producer = 'types', tooling_failure = NULL
            WHERE validation_run_id = ${started.validationRunId}
              AND phase = 'checks' AND producer = 'types'
          `,
        );
        expect(
          yield* validation.reads.listPhaseResults(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        yield* repository.operation(
          "corrupt Validation phase name",
          (sql) => sql`
            UPDATE validation_phase_results SET phase = 'unknown_phase', producer = 'types'
            WHERE validation_run_id = ${started.validationRunId} AND phase = 'prepare'
          `,
        );
        expect(
          yield* validation.reads.listPhaseResults(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );
});
