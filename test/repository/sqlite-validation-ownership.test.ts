import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import type { AgentSessionConfiguration } from "../../src/agent/agentSession/agentSession.js";
import { openSqliteCandidateCapturePersistence } from "../../src/change/adapters/sqlite/sqliteCandidateCapturePersistence.js";
import { internalChangeId } from "../../src/change/changeId.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../../src/task/adapters/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/task/adapters/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const configuration: AgentSessionConfiguration = {
  harness: "pi",
  provider: null,
  model: "provider/model",
  thinking: "medium",
};

const specialist = (id: string) => ({
  id,
  instructions: `Review ${id}.`,
  instructionsSource: "repo" as const,
  profile: {
    agentProfile: id,
    scope: "repo" as const,
    profile: { agentRuntime: "pi" as const, runtimeConfig: { model: `${id}-model` } },
  },
});

const policy = {
  checks: [{ id: "types", command: "pnpm typecheck", timeoutSeconds: 30 }],
};

const reviewerConfiguration = {
  acceptanceReview: null,
  specialistReviews: [specialist("first"), specialist("second")],
};

const taskReviewPolicy = {
  profile: {
    agentProfile: "review",
    scope: "repo" as const,
    profile: {
      agentRuntime: "pi" as const,
      runtimeConfig: { model: "provider/model", thinking: "medium" as const },
    },
  },
  builtInInstructions: "Review the Task proposal.",
  guidance: null,
};

const createRun = (
  commonDirectory: string,
  branch: string,
  overrides: {
    readonly checks?: readonly {
      readonly id: string;
      readonly command: string;
      readonly timeoutSeconds: number;
    }[];
    readonly reviewerConfiguration?: typeof reviewerConfiguration;
  } = {},
) =>
  Effect.gen(function* () {
    const checks = overrides.checks ?? policy.checks;
    const configuredReviewers = overrides.reviewerConfiguration ?? reviewerConfiguration;
    const repository = yield* RepositorySql;
    yield* repository.operation(
      "create Validation ownership Change",
      (sql) => sql`
        INSERT INTO changes (
          branch_ref, base_ref, base_remote_url, worktree_path,
          reviewer_configuration, checks_definition, cleanup_pending
        ) VALUES (
          ${`refs/heads/${branch}`}, 'refs/remotes/origin/main',
          'https://example.com/acme/repo.git', ${`/tmp/${branch}`},
          ${JSON.stringify(configuredReviewers)}, ${JSON.stringify(checks)},
          0
        )
      `,
    );
    const capture = yield* openSqliteCandidateCapturePersistence();
    const validation = yield* openSqliteChangeValidationTestDependencies();
    const captured = yield* capture.commitCapture({
      repositoryCommonDirectory: commonDirectory,
      branchRef: `refs/heads/${branch}`,
      baseRef: "refs/remotes/origin/main",
      changeBaseSha: "base",
      headSha: `${branch}-head`,
    });
    if (!captured.ok) throw new Error(captured.code);
    const started = yield* validation.execution.startOrReuse({
      candidateId: captured.candidateId,
      changeBaseSha: "base",
      headSha: `${branch}-head`,
    });
    if (started.reused || "blocked" in started || "active" in started) {
      throw new Error("Expected a new Validation Run");
    }
    return { captured, started, validation };
  });

const beginInvocation = (
  validation: ChangeValidationTestDependencies,
  input: {
    readonly validationRunId: number;
    readonly changeId: string;
    readonly producer: string;
    readonly agentSessionId?: number;
  },
) =>
  validation.agentPersistence.beginInvocation({
    ...(input.agentSessionId === undefined ? {} : { agentSessionId: input.agentSessionId }),
    configuration: {
      harness: "pi",
      provider: null,
      model: `${input.producer}-model`,
      thinking: null,
    },
    createdAt: "2026-10-02T10:00:00.000Z",
    linkInvocation: validation.agentSessions.linkAgentInvocation({
      validationRunId: input.validationRunId,
      changeId: input.changeId,
      phase: "specialist_review",
      producer: input.producer,
      configurationSnapshot: specialist(input.producer),
    }),
  });

describe("SQLite Validation ownership", () => {
  it.scoped("settles only an active configured phase and its exact linked Agent Invocation", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const { captured, started, validation } = yield* createRun(
          input.commonDirectory,
          "phase-settlement",
        );

        expect(
          yield* validation.execution
            .recordCheckResult({
              validationRunId: started.validationRunId,
              producer: "unconfigured",
              outcome: "passed",
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* validation.execution
            .recordSpecialistResult({
              validationRunId: started.validationRunId,
              producer: "first",
              outcome: "passed",
              findings: [],
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const invocation = yield* beginInvocation(validation, {
          validationRunId: started.validationRunId,
          changeId: captured.changeId,
          producer: "first",
        });
        if (!invocation.ok) throw new Error(invocation.code);
        const settlement = {
          invocationId: invocation.dispatch.invocation.id,
          continuationId: invocation.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-10-02T10:00:01.000Z",
            kind: "returned" as const,
          },
        };
        expect(
          yield* validation.agentPersistence
            .settleInvocation({
              ...settlement,
              settleDomain: validation.execution.settleAgentInvocationResult({
                validationRunId: started.validationRunId,
                phase: "specialist_review",
                producer: "second",
                outcome: "passed",
                findings: [],
                artifactRecords: [],
              }),
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        yield* validation.agentPersistence.settleInvocation({
          ...settlement,
          settleDomain: validation.execution.settleAgentInvocationResult({
            validationRunId: started.validationRunId,
            phase: "specialist_review",
            producer: "first",
            outcome: "passed",
            findings: [],
            artifactRecords: [],
          }),
        });
        expect(
          yield* beginInvocation(validation, {
            validationRunId: started.validationRunId,
            changeId: captured.changeId,
            producer: "first",
            agentSessionId: invocation.dispatch.agentSessionId,
          }).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* validation.execution.recordCheckResult({
          validationRunId: started.validationRunId,
          producer: "types",
          outcome: "passed",
          artifactRecords: [],
        });
        const secondInvocation = yield* beginInvocation(validation, {
          validationRunId: started.validationRunId,
          changeId: captured.changeId,
          producer: "second",
        });
        if (!secondInvocation.ok) throw new Error(secondInvocation.code);
        yield* validation.agentPersistence.settleInvocation({
          invocationId: secondInvocation.dispatch.invocation.id,
          continuationId: secondInvocation.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-10-02T10:00:02.000Z",
            kind: "returned",
          },
          settleDomain: validation.execution.settleAgentInvocationResult({
            validationRunId: started.validationRunId,
            phase: "specialist_review",
            producer: "second",
            outcome: "passed",
            findings: [],
            artifactRecords: [],
          }),
        });
        yield* validation.execution.recordWorkspaceCleanup({
          validationRunId: started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* validation.execution.complete({
          validationRunId: started.validationRunId,
          outcome: "passed",
        });
        expect(
          yield* validation.execution
            .recordCheckResult({
              validationRunId: started.validationRunId,
              producer: "types",
              outcome: "passed",
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const repository = yield* RepositorySql;
        yield* repository.operation(
          "corrupt linked Agent Invocation position",
          (sql) => sql`
            UPDATE validation_phase_agent_invocations
            SET phase = 'prepare', producer = 'first'
            WHERE validation_run_id = ${started.validationRunId}
          `,
        );
        expect(
          yield* validation.reads.listAgentInvocations(started.validationRunId).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );

  it.scoped("requires complete Check evidence but permits a blocked Specialist prefix", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const checks = yield* createRun(input.commonDirectory, "incomplete-checks", {
          checks: [
            { id: "types", command: "true", timeoutSeconds: 30 },
            { id: "lint", command: "true", timeoutSeconds: 30 },
          ],
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        yield* checks.validation.execution.recordCheckResult({
          validationRunId: checks.started.validationRunId,
          producer: "types",
          outcome: "failed",
          finding: {
            validationRunId: checks.started.validationRunId,
            phase: "checks",
            producer: "types",
            title: "Fix the Check",
            description: "The Check does not pass.",
            evidence: "The Check reported a failure.",
            files: [],
            artifactRefs: [],
          },
          artifactRecords: [],
        });
        yield* checks.validation.execution.recordWorkspaceCleanup({
          validationRunId: checks.started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        expect(
          yield* checks.validation.execution
            .complete({
              validationRunId: checks.started.validationRunId,
              outcome: "blocked",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* checks.validation.execution.recordCheckResult({
          validationRunId: checks.started.validationRunId,
          producer: "lint",
          outcome: "passed",
          artifactRecords: [],
        });
        yield* checks.validation.execution.complete({
          validationRunId: checks.started.validationRunId,
          outcome: "blocked",
        });

        const specialists = yield* createRun(input.commonDirectory, "specialist-prefix");
        yield* specialists.validation.execution.recordCheckResult({
          validationRunId: specialists.started.validationRunId,
          producer: "types",
          outcome: "passed",
          artifactRecords: [],
        });
        const invocation = yield* beginInvocation(specialists.validation, {
          validationRunId: specialists.started.validationRunId,
          changeId: specialists.captured.changeId,
          producer: "first",
        });
        if (!invocation.ok) throw new Error(invocation.code);
        yield* specialists.validation.agentPersistence.settleInvocation({
          invocationId: invocation.dispatch.invocation.id,
          continuationId: invocation.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-10-02T10:00:03.000Z",
            kind: "returned",
          },
          settleDomain: specialists.validation.execution.settleAgentInvocationResult({
            validationRunId: specialists.started.validationRunId,
            phase: "specialist_review",
            producer: "first",
            outcome: "failed",
            findings: [
              {
                validationRunId: specialists.started.validationRunId,
                phase: "specialist_review",
                producer: "first",
                title: "Specialist Finding",
                description: "The Specialist found a blocking problem.",
                evidence: "The Candidate does not satisfy the concern.",
                files: [],
                artifactRefs: [],
              },
            ],
            artifactRecords: [],
          }),
        });
        yield* specialists.validation.execution.recordWorkspaceCleanup({
          validationRunId: specialists.started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* specialists.validation.execution.complete({
          validationRunId: specialists.started.validationRunId,
          outcome: "blocked",
        });
        expect(
          (yield* specialists.validation.reads.listPhaseResults(
            specialists.started.validationRunId,
          )).map(({ producer, outcome }) => ({ producer, outcome })),
        ).toEqual([
          { producer: "types", outcome: "passed" },
          { producer: "first", outcome: "failed" },
        ]);

        const invalidSpecialists = yield* createRun(
          input.commonDirectory,
          "specialist-after-failure",
          {
            reviewerConfiguration: {
              acceptanceReview: null,
              specialistReviews: [specialist("first"), specialist("second"), specialist("third")],
            },
          },
        );
        yield* invalidSpecialists.validation.execution.recordCheckResult({
          validationRunId: invalidSpecialists.started.validationRunId,
          producer: "types",
          outcome: "passed",
          artifactRecords: [],
        });
        const failedInvocation = yield* beginInvocation(invalidSpecialists.validation, {
          validationRunId: invalidSpecialists.started.validationRunId,
          changeId: invalidSpecialists.captured.changeId,
          producer: "first",
        });
        if (!failedInvocation.ok) throw new Error(failedInvocation.code);
        yield* invalidSpecialists.validation.agentPersistence.settleInvocation({
          invocationId: failedInvocation.dispatch.invocation.id,
          continuationId: failedInvocation.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-10-02T10:00:04.000Z",
            kind: "returned",
          },
          settleDomain: invalidSpecialists.validation.execution.settleAgentInvocationResult({
            validationRunId: invalidSpecialists.started.validationRunId,
            phase: "specialist_review",
            producer: "first",
            outcome: "failed",
            findings: [
              {
                validationRunId: invalidSpecialists.started.validationRunId,
                phase: "specialist_review",
                producer: "first",
                title: "First Specialist Finding",
                description: "The first Specialist found a blocking problem.",
                evidence: "The Candidate does not satisfy the concern.",
                files: [],
                artifactRefs: [],
              },
            ],
            artifactRecords: [],
          }),
        });
        const laterInvocation = yield* beginInvocation(invalidSpecialists.validation, {
          validationRunId: invalidSpecialists.started.validationRunId,
          changeId: invalidSpecialists.captured.changeId,
          producer: "second",
        });
        if (!laterInvocation.ok) throw new Error(laterInvocation.code);
        yield* invalidSpecialists.validation.agentPersistence.settleInvocation({
          invocationId: laterInvocation.dispatch.invocation.id,
          continuationId: laterInvocation.dispatch.continuation.id,
          settlement: {
            settledAt: "2026-10-02T10:00:05.000Z",
            kind: "returned",
          },
          settleDomain: invalidSpecialists.validation.execution.settleAgentInvocationResult({
            validationRunId: invalidSpecialists.started.validationRunId,
            phase: "specialist_review",
            producer: "second",
            outcome: "passed",
            findings: [],
            artifactRecords: [],
          }),
        });
        yield* invalidSpecialists.validation.execution.recordWorkspaceCleanup({
          validationRunId: invalidSpecialists.started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        expect(
          yield* invalidSpecialists.validation.execution
            .complete({
              validationRunId: invalidSpecialists.started.validationRunId,
              outcome: "blocked",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );

  it.scoped("validates embedded phase evidence before persisting its final Result", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const fixture = yield* createRun(input.commonDirectory, "phase-evidence");
        const position = {
          validationRunId: fixture.started.validationRunId,
          phase: "checks" as const,
          producer: "types",
        };
        expect(
          yield* fixture.validation.execution
            .recordToolingFailure({
              validationRunId: position.validationRunId,
              errorKind: "infrastructure_tooling_failed",
              operationName: " ",
              errorMessage: "This malformed failure must not persist.",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "passed",
              artifactRecords: [
                {
                  ref: `artifact:${position.validationRunId}/checks/types/stdout.txt`,
                  ...position,
                  path: `${position.validationRunId}/checks/types/stdout.txt`,
                  originalBytes: 1,
                  storedBytes: 2,
                  truncated: false,
                },
              ],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "failed",
              finding: {
                ...position,
                title: "Mismatched Artifact owner",
                description: "The Artifact claims another Validation Result owner.",
                evidence: "The Artifact reference and path use a different owner tuple.",
                files: [],
                artifactRefs: ["artifact:999/specialist_review/other/stdout.txt"],
              },
              artifactRecords: [
                {
                  ref: "artifact:999/specialist_review/other/stdout.txt",
                  ...position,
                  path: "999/specialist_review/other/stdout.txt",
                  originalBytes: 1,
                  storedBytes: 1,
                  truncated: false,
                },
              ],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "failed",
              finding: {
                ...position,
                title: "   ",
                description: "The Candidate is invalid.",
                evidence: "Observed in the Candidate.",
                files: [],
                artifactRefs: [],
              },
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "failed",
              finding: {
                ...position,
                title: "Invalid file path",
                description: "The Finding must not persist.",
                evidence: "The file path is absolute.",
                files: ["/absolute/path.ts"],
                artifactRefs: [],
              },
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "failed",
              finding: {
                ...position,
                title: "Invalid Artifact reference",
                description: "The Finding must not persist.",
                evidence: "The Artifact reference syntax is invalid.",
                files: [],
                artifactRefs: ["not-an-artifact"],
              },
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "failed",
              finding: {
                ...position,
                title: "Unresolved Artifact reference",
                description: "The Finding must not persist.",
                evidence: "The Artifact does not exist in this Validation Run.",
                files: [],
                artifactRefs: [`artifact:${position.validationRunId}/checks/types/missing.txt`],
              },
              artifactRecords: [],
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.execution
            .recordCheckResult({
              validationRunId: position.validationRunId,
              producer: position.producer,
              outcome: "failed",
              artifactRecords: [],
              toolingFailure: {
                validationRunId: position.validationRunId,
                errorKind: "check_command_execution_tooling_failed",
                operationName: "   ",
                errorMessage: "The Check command failed.",
              },
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const repository = yield* RepositorySql;
        expect(
          yield* repository.operation(
            "inspect rejected Validation Phase Results",
            (sql) => sql<{
              readonly count: number;
              readonly runToolingFailure: string | null;
              readonly outcome: string | null;
            }>`
              SELECT
                (SELECT COUNT(*) FROM validation_phase_results
                  WHERE validation_run_id = run.id) AS count,
                run.run_tooling_failure AS runToolingFailure,
                run.outcome
              FROM validation_runs AS run WHERE run.id = ${position.validationRunId}
            `,
          ),
        ).toEqual([{ count: 0, runToolingFailure: null, outcome: null }]);

        yield* fixture.validation.execution.recordCheckResult({
          validationRunId: position.validationRunId,
          producer: position.producer,
          outcome: "failed",
          finding: {
            ...position,
            title: "Fix the Check",
            description: "The Candidate does not pass the Check.",
            evidence: "The Check output contains an error.",
            files: [],
            artifactRefs: [`artifact:${position.validationRunId}/checks/types/stdout.txt`],
          },
          artifactRecords: [
            {
              ref: `artifact:${position.validationRunId}/checks/types/stdout.txt`,
              ...position,
              path: `${position.validationRunId}/checks/types/stdout.txt`,
              originalBytes: 3,
              storedBytes: 2,
              truncated: true,
            },
          ],
        });
        yield* fixture.validation.execution.recordWorkspaceCleanup({
          validationRunId: position.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* fixture.validation.execution.complete({
          validationRunId: position.validationRunId,
          outcome: "blocked",
        });
        expect(
          yield* fixture.validation.reads.listArtifacts(position.validationRunId),
        ).toMatchObject([
          {
            path: `${position.validationRunId}/checks/types/stdout.txt`,
            originalBytes: 3,
            storedBytes: 2,
            truncated: true,
          },
        ]);
      }),
    ),
  );

  it.scoped("binds a final reviewer Result to its settled terminal Invocation", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const fixture = yield* createRun(input.commonDirectory, "terminal-invocation");
        const invocation = yield* beginInvocation(fixture.validation, {
          validationRunId: fixture.started.validationRunId,
          changeId: fixture.captured.changeId,
          producer: "first",
        });
        if (!invocation.ok) throw new Error(invocation.code);
        expect(
          yield* fixture.validation.execution
            .recordSpecialistResult({
              validationRunId: fixture.started.validationRunId,
              producer: "first",
              outcome: "failed",
              findings: [],
              artifactRecords: [],
              toolingFailure: {
                validationRunId: fixture.started.validationRunId,
                errorKind: "infrastructure_tooling_failed",
                operationName: "verify_specialist_candidate",
                errorMessage: "This failure did not occur before dispatch.",
              },
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.agentPersistence
            .settleInvocation({
              invocationId: invocation.dispatch.invocation.id,
              continuationId: invocation.dispatch.continuation.id,
              settlement: {
                settledAt: "2026-10-02T10:00:05.000Z",
                kind: "launch_failed",
              },
              settleDomain: fixture.validation.execution.settleAgentInvocationResult({
                validationRunId: fixture.started.validationRunId,
                phase: "specialist_review",
                producer: "first",
                outcome: "failed",
                findings: [
                  {
                    validationRunId: fixture.started.validationRunId,
                    phase: "specialist_review",
                    producer: "first",
                    title: "Fabricated Finding",
                    description: "No reviewer response exists.",
                    evidence: "The Invocation did not return.",
                    files: [],
                    artifactRefs: [],
                  },
                ],
                artifactRecords: [],
              }),
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        yield* fixture.validation.agentPersistence.settleInvocation({
          invocationId: invocation.dispatch.invocation.id,
          continuationId: invocation.dispatch.continuation.id,
          settlement: { settledAt: "2026-10-02T10:00:06.000Z", kind: "returned" },
        });

        yield* fixture.validation.execution.recordToolingFailure({
          validationRunId: fixture.started.validationRunId,
          errorKind: "reviewer_process_execution_failed",
          operationName: "run_specialist_reviewer",
          errorMessage: "The reviewer Invocation has no final Phase Result.",
        });
        yield* fixture.validation.execution.recordWorkspaceCleanup({
          validationRunId: fixture.started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        expect(
          yield* fixture.validation.execution
            .complete({
              validationRunId: fixture.started.validationRunId,
              outcome: "tooling_failed",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );

  it.scoped("rejects Change Sessions for non-review phases and reviewers outside the roster", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const fixture = yield* createRun(input.commonDirectory, "reviewer-roster");
        expect(
          yield* fixture.validation.agentPersistence
            .beginInvocation({
              configuration,
              createdAt: "2026-10-02T10:00:10.000Z",
              linkInvocation: fixture.validation.agentSessions.linkAgentInvocation({
                validationRunId: fixture.started.validationRunId,
                changeId: fixture.captured.changeId,
                phase: "checks",
                producer: "types",
                configurationSnapshot: specialist("first"),
              }),
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        expect(
          yield* fixture.validation.agentPersistence
            .beginInvocation({
              configuration,
              createdAt: "2026-10-02T10:00:11.000Z",
              linkInvocation: fixture.validation.agentSessions.linkAgentInvocation({
                validationRunId: fixture.started.validationRunId,
                changeId: fixture.captured.changeId,
                phase: "specialist_review",
                producer: "first",
                configurationSnapshot: specialist("first"),
              }),
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        yield* fixture.validation.execution.recordToolingFailure({
          validationRunId: fixture.started.validationRunId,
          errorKind: "snapshot_workspace_setup_failed",
          operationName: "set_up_snapshot_workspace",
          errorMessage: "Stop the roster fixture Run.",
        });
        yield* fixture.validation.execution.recordWorkspaceCleanup({
          validationRunId: fixture.started.validationRunId,
          cleanupWorkspace: "not_created",
        });
        yield* fixture.validation.execution.complete({
          validationRunId: fixture.started.validationRunId,
          outcome: "tooling_failed",
        });
      }),
    ),
  );

  it.scoped("rejects Change Invocation links with the wrong Change or an owned Agent Session", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const first = yield* createRun(input.commonDirectory, "owner-first");
        const second = yield* createRun(input.commonDirectory, "owner-second");

        expect(
          yield* beginInvocation(first.validation, {
            validationRunId: first.started.validationRunId,
            changeId: second.captured.changeId,
            producer: "first",
          }).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const unowned = yield* first.validation.agentPersistence.beginInvocation({
          configuration,
          createdAt: "2026-10-02T10:01:00.000Z",
          linkInvocation: () => Effect.void,
        });
        if (!unowned.ok) throw new Error(unowned.code);
        yield* first.validation.agentPersistence.settleInvocation({
          invocationId: unowned.dispatch.invocation.id,
          continuationId: unowned.dispatch.continuation.id,
          settlement: { settledAt: "2026-10-02T10:01:01.000Z", kind: "returned" },
        });
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "assign Agent Session to Task",
          (sql) => sql`
            INSERT INTO tasks (
              id, title, description, state, reviewer_configuration, reviewer_agent_session_id
            ) VALUES (
              1, 'Session owner', 'Own the reviewer Session.', 'new', '{}',
              ${unowned.dispatch.agentSessionId}
            )
          `,
        );
        expect(
          yield* beginInvocation(first.validation, {
            validationRunId: first.started.validationRunId,
            changeId: first.captured.changeId,
            producer: "first",
            agentSessionId: unowned.dispatch.agentSessionId,
          }).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const changeOwned = yield* first.validation.agentPersistence.beginInvocation({
          configuration,
          createdAt: "2026-10-02T10:01:02.000Z",
          linkInvocation: () => Effect.void,
        });
        if (!changeOwned.ok) throw new Error(changeOwned.code);
        yield* first.validation.agentPersistence.settleInvocation({
          invocationId: changeOwned.dispatch.invocation.id,
          continuationId: changeOwned.dispatch.continuation.id,
          settlement: { settledAt: "2026-10-02T10:01:03.000Z", kind: "returned" },
        });
        yield* repository.operation(
          "assign Agent Session to another Change",
          (sql) => sql`
            INSERT INTO change_agent_sessions (change_id, producer, agent_session_id)
            VALUES (
              ${internalChangeId(second.captured.changeId, repository.idPrefix)},
              'first', ${changeOwned.dispatch.agentSessionId}
            )
          `,
        );
        expect(
          yield* beginInvocation(first.validation, {
            validationRunId: first.started.validationRunId,
            changeId: first.captured.changeId,
            producer: "first",
            agentSessionId: changeOwned.dispatch.agentSessionId,
          }).pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }),
    ),
  );

  it.scoped(
    "rejects a Change Invocation whose reviewer configuration differs from frozen policy",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const fixture = yield* createRun(input.commonDirectory, "invalid-correction");
          const initial = yield* fixture.validation.agentPersistence.beginInvocation({
            configuration,
            createdAt: "2026-10-02T10:01:10.000Z",
            linkInvocation: () => Effect.void,
          });
          if (!initial.ok) throw new Error(initial.code);
          yield* fixture.validation.agentPersistence.settleInvocation({
            invocationId: initial.dispatch.invocation.id,
            continuationId: initial.dispatch.continuation.id,
            settlement: {
              settledAt: "2026-10-02T10:01:11.000Z",
              kind: "launch_failed",
              unusableReason: "Correct the Specialist configuration.",
            },
          });

          expect(
            yield* fixture.validation.agentPersistence
              .beginInvocation({
                agentSessionId: initial.dispatch.agentSessionId,
                configuration,
                createdAt: "2026-10-02T10:01:12.000Z",
                linkInvocation: fixture.validation.agentSessions.linkAgentInvocation({
                  validationRunId: fixture.started.validationRunId,
                  changeId: fixture.captured.changeId,
                  phase: "specialist_review",
                  producer: "first",
                  configurationSnapshot: { ...specialist("first"), id: "acceptance" },
                }),
              })
              .pipe(Effect.flip),
          ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        }),
      ),
  );

  it.scoped("makes Task Review admission the sole reviewer policy authority", () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const tasks = yield* openSqliteTaskPersistence();
        const reviews = yield* openSqliteTaskReviewPersistence();
        const validation = yield* openSqliteChangeValidationTestDependencies();
        yield* tasks.createTask({
          title: "Owner",
          description: "Review owner.",
          now: "2026-10-02T10:02:00.000Z",
        });

        expect(
          yield* reviews
            .admit({
              taskId: publicTaskId(`${repository.idPrefix}-1`),
              policy: {
                ...taskReviewPolicy,
                profile: {
                  ...taskReviewPolicy.profile,
                  profile: {
                    ...taskReviewPolicy.profile.profile,
                    runtimeConfig: { model: " " },
                  },
                },
              },
              baseRef: "refs/heads/main",
              baseCommit: "base",
              now: "2026-10-02T10:02:00.000Z",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
        const rejectedAdmission = yield* repository.operation(
          "inspect rejected Task Review admission",
          (sql) => sql<{
            readonly reviewerConfiguration: string | null;
            readonly reviewerAgentSessionId: number | null;
            readonly reviewCount: number;
            readonly sessionCount: number;
          }>`
            SELECT task.reviewer_configuration AS reviewerConfiguration,
              task.reviewer_agent_session_id AS reviewerAgentSessionId,
              (SELECT COUNT(*) FROM task_reviews) AS reviewCount,
              (SELECT COUNT(*) FROM agent_sessions) AS sessionCount
            FROM tasks AS task WHERE task.id = 1
          `,
        );
        expect(rejectedAdmission).toEqual([
          {
            reviewerConfiguration: null,
            reviewerAgentSessionId: null,
            reviewCount: 0,
            sessionCount: 0,
          },
        ]);

        const admitted = yield* reviews.admit({
          taskId: publicTaskId(`${repository.idPrefix}-1`),
          policy: taskReviewPolicy,
          baseRef: "refs/heads/main",
          baseCommit: "base",
          now: "2026-10-02T10:02:01.000Z",
        });
        if (!admitted.ok) throw new Error(admitted.code);
        expect(
          yield* reviews.getReviewerAgentSession(publicTaskId(`${repository.idPrefix}-1`)),
        ).toBeUndefined();
        const firstInvocation = yield* validation.agentPersistence.beginInvocation({
          configuration,
          createdAt: "2026-10-02T10:02:02.000Z",
          linkInvocation: reviews.linkAgentInvocation({
            taskId: publicTaskId(`${repository.idPrefix}-1`),
            reviewId: admitted.review.id,
            admittedPolicy: admitted.policy,
          }),
        });
        if (!firstInvocation.ok) throw new Error(firstInvocation.code);
        yield* validation.agentPersistence.settleInvocation({
          invocationId: firstInvocation.dispatch.invocation.id,
          continuationId: firstInvocation.dispatch.continuation.id,
          settlement: { settledAt: "2026-10-02T10:02:03.000Z", kind: "returned" },
        });
        const agentSessionId = firstInvocation.dispatch.agentSessionId;
        const competingPolicy = {
          ...taskReviewPolicy,
          profile: {
            ...taskReviewPolicy.profile,
            profile: {
              ...taskReviewPolicy.profile.profile,
              runtimeConfig: { model: "competing-model", thinking: "medium" as const },
            },
          },
        };
        expect(
          yield* validation.agentPersistence
            .beginInvocation({
              agentSessionId,
              configuration: { ...configuration, model: "competing-model" },
              createdAt: "2026-10-02T10:02:04.000Z",
              linkInvocation: reviews.linkAgentInvocation({
                taskId: publicTaskId(`${repository.idPrefix}-1`),
                reviewId: admitted.review.id,
                admittedPolicy: competingPolicy,
              }),
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);

        const retained = yield* repository.operation(
          "inspect rejected Task Agent Invocation link",
          (sql) => sql<{
            readonly reviewerConfiguration: string | null;
            readonly reviewerAgentSessionId: number | null;
            readonly continuationCount: number;
            readonly invocationCount: number;
            readonly invocationLinks: number;
          }>`
            SELECT task.reviewer_configuration AS reviewerConfiguration,
              task.reviewer_agent_session_id AS reviewerAgentSessionId,
              (SELECT COUNT(*) FROM agent_continuations) AS continuationCount,
              (SELECT COUNT(*) FROM agent_invocations) AS invocationCount,
              (SELECT COUNT(*) FROM task_review_agent_invocations
                WHERE task_review_id = ${admitted.review.id}) AS invocationLinks
            FROM tasks AS task WHERE task.id = 1
          `,
        );
        expect(retained).toEqual([
          {
            reviewerConfiguration: JSON.stringify(taskReviewPolicy),
            reviewerAgentSessionId: agentSessionId,
            continuationCount: 1,
            invocationCount: 1,
            invocationLinks: 1,
          },
        ]);
      }),
    ),
  );
});
