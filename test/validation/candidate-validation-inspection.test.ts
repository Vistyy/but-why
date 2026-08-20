import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";
import { openSqliteAgentSessionPersistence } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type { ChangeReviewerPolicy } from "../../src/change/changeReviewerConfiguration.js";
import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import {
  RepositorySql,
  repositorySqlLayer,
} from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteValidationRunAbandonmentPort } from "../../src/sqlite/sqliteValidationRunAbandonmentPersistence.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import {
  type ChangeValidationTestDependencies,
  openSqliteChangeValidationTestDependencies,
} from "../support/changeValidationPorts.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-07-18T10:00:00.000Z";
const later = "2026-07-18T10:05:00.000Z";

const policy = {
  prepare: { command: "pnpm install", timeoutSeconds: 60 },
  checks: [
    { id: "types", command: "pnpm typecheck", timeoutSeconds: 30 },
    { id: "tests", command: "pnpm test", timeoutSeconds: 30 },
  ],
};

const reviewerConfiguration = {
  acceptanceReview: {
    instructions: "Review acceptance.",
    instructionsSource: "built_in" as const,
    profile: {
      agentProfile: "acceptance",
      scope: "global" as const,
      profile: { agentRuntime: "pi" as const, runtimeConfig: { model: "test-model" } },
    },
  },
  specialistReviews: [],
};

const unlinkedReviewerConfiguration = {
  acceptanceReview: null,
  specialistReviews: [],
};

const linkedAcceptanceContext = {
  version: 1 as const,
  title: "Linked acceptance",
  description: "Preserve linked Change authority.",
};
let candidateValidationRepoTemplate: string;

beforeAll(() => {
  candidateValidationRepoTemplate = acquireTestWorkspace();
  createInitializedRepo(candidateValidationRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(candidateValidationRepoTemplate);
});

describe("Candidate-owned Validation Run inspection", () => {
  it.effect("abandons an interrupted Validation Run and is idempotent", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.recordWorkspaceCleanup({
        validationRunId: fixture.validationRunId,
        cleanupWorkspace: "not_created",
      });
      const abandoned = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "abandon",
        String(fixture.validationRunId),
        "--reason",
        "Validation process terminated.",
      ]);

      expect(abandoned.status, abandoned.stdout).toBe(0);
      expect(JSON.parse(abandoned.stdout)).toMatchObject({
        status: "abandoned",
        validationRunId: fixture.validationRunId,
      });
      expect(yield* fixture.runStore.getRunById(fixture.validationRunId)).toMatchObject({
        state: "complete",
        outcome: "tooling_failed",
      });

      const repeated = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "abandon",
        String(fixture.validationRunId),
        "--reason",
        "Repeated cleanup.",
      ]);
      expect(repeated.status).toBe(0);
      expect(JSON.parse(repeated.stdout).status).toBe("already_complete");
    }),
  );

  it.effect("settles linked Agent Invocations when a Validation Run is abandoned", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture({ linked: true });
      const result = yield* withTestRepository(
        fixture.root,
        Effect.gen(function* () {
          const agents = yield* openSqliteAgentSessionPersistence();
          const agentSessions = yield* openSqliteChangeAgentSessionPort();
          const abandonment = yield* openSqliteValidationRunAbandonmentPort();
          const linkAgentInvocation = agentSessions.linkAgentInvocation;
          if (linkAgentInvocation === undefined)
            throw new Error("Change Agent linking is unavailable");
          const started = yield* agents.beginInvocation({
            configuration: { harness: "pi", model: "test-model", thinking: null },
            createdAt: now,
            linkInvocation: linkAgentInvocation({
              changeId: fixture.changeId,
              producer: "acceptance",
              validationRunId: fixture.validationRunId,
              phase: "acceptance_review",
              configurationSnapshot: reviewerConfiguration.acceptanceReview,
            }),
          });
          if (!started.ok) throw new Error(`Could not start Invocation: ${started.code}`);
          expect(
            yield* abandonment
              .recordToolingFailure({
                validationRunId: fixture.validationRunId,
                errorKind: "infrastructure_tooling_failed",
                operationName: " ",
                errorMessage: "This malformed failure must not persist.",
              })
              .pipe(Effect.flip),
          ).toBeInstanceOf(RepositoryPersistedDataInvalid);
          expect(
            yield* abandonment
              .abandon({
                validationRunId: fixture.validationRunId,
                errorKind: "unsupported_failure_kind",
                operationName: "validation_run_abandonment",
                errorMessage: "This malformed abandonment must not settle the Invocation.",
                now: later,
              })
              .pipe(Effect.flip),
          ).toBeInstanceOf(RepositoryPersistedDataInvalid);
          expect(
            yield* agents.readInvocationHistory(started.dispatch.agentSessionId),
          ).toMatchObject([{ settledAt: null, settlementKind: null }]);
          expect(yield* abandonment.getRunById(fixture.validationRunId)).toMatchObject({
            state: "running",
            outcome: null,
          });

          yield* abandonment.abandon({
            validationRunId: fixture.validationRunId,
            errorKind: "infrastructure_tooling_failed",
            operationName: "validation_run_abandonment",
            errorMessage: "Reviewer process stopped",
            now: later,
          });
          const history = yield* agents.readInvocationHistory(started.dispatch.agentSessionId);
          return history;
        }),
      );

      expect(result).toMatchObject([
        {
          settlementKind: "return_unknown",
          settledAt: later,
          usage: null,
          continuation: {
            unusableReason: expect.stringContaining("Reviewer process stopped"),
          },
        },
      ]);
    }),
  );

  it.effect("projects measured Agent Invocation usage with public token names", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture({ linked: true });
      const dispatch = yield* withTestRepository(
        fixture.root,
        Effect.gen(function* () {
          const agents = yield* openSqliteAgentSessionPersistence();
          const agentSessions = yield* openSqliteChangeAgentSessionPort();
          const abandonment = yield* openSqliteValidationRunAbandonmentPort();
          const linkAgentInvocation = agentSessions.linkAgentInvocation;
          if (linkAgentInvocation === undefined)
            throw new Error("Change Agent linking is unavailable");
          const started = yield* agents.beginInvocation({
            configuration: { harness: "pi", model: "test-model", thinking: null },
            createdAt: now,
            linkInvocation: linkAgentInvocation({
              changeId: fixture.changeId,
              producer: "acceptance",
              validationRunId: fixture.validationRunId,
              phase: "acceptance_review",
              configurationSnapshot: reviewerConfiguration.acceptanceReview,
            }),
          });
          if (!started.ok) throw new Error(`Could not start Invocation: ${started.code}`);
          yield* agents.settleInvocation({
            invocationId: started.dispatch.invocation.id,
            continuationId: started.dispatch.continuation.id,
            settlement: {
              settledAt: later,
              kind: "returned",
              usage: {
                inputTokens: 10,
                cachedInputTokens: 2,
                cacheWriteTokens: 3,
                outputTokens: 4,
                totalTokens: 19,
              },
            },
          });
          yield* abandonment.abandon({
            validationRunId: fixture.validationRunId,
            errorKind: "infrastructure_tooling_failed",
            operationName: "validation_run_abandonment",
            errorMessage: "Agent Invocation inspection fixture",
            now: later,
          });
          return started.dispatch;
        }),
      );
      const shown = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "show",
        String(fixture.validationRunId),
      ]);

      expect(shown.status, shown.stdout).toBe(0);
      expect(JSON.parse(shown.stdout).agentInvocations).toEqual([
        {
          id: dispatch.invocation.id,
          phase: "acceptance_review",
          producer: "acceptance",
          continuationId: dispatch.continuation.id,
          createdAt: now,
          settledAt: later,
          settlementKind: "returned",
          usage: { input: 10, cacheRead: 2, cacheWrite: 3, output: 4, total: 19 },
          continuation: {
            id: dispatch.continuation.id,
            agentSessionId: dispatch.agentSessionId,
            harness: "pi",
            provider: null,
            model: "test-model",
            thinking: null,
            transcriptPath: null,
            unusableReason: null,
          },
        },
      ]);
    }),
  );

  it.effect("keeps failed cleanup recoverable until abandonment succeeds", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.recordWorkspaceCleanup({
        validationRunId: fixture.validationRunId,
        cleanupWorkspace: "failed",
        cleanupBlockingReason: "Workspace HEAD did not match the Candidate commit.",
      });
      expect(
        yield* fixture.runStore
          .complete({
            validationRunId: fixture.validationRunId,
            outcome: "tooling_failed",
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);

      expect(yield* fixture.runStore.getRunById(fixture.validationRunId)).toMatchObject({
        state: "running",
        outcome: null,
        cleanup: {
          state: "pending",
          blockingReason: "Workspace HEAD did not match the Candidate commit.",
        },
      });
      const inspected = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "show",
        String(fixture.validationRunId),
      ]);
      expect(inspected.status).toBe(0);
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        workspace: {
          cleanup: "pending",
          blockingReason: "Workspace HEAD did not match the Candidate commit.",
        },
      });

      const abandoned = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "abandon",
        String(fixture.validationRunId),
        "--reason",
        "Retry failed cleanup.",
      ]);
      expect(abandoned.status).toBe(0);
      expect(JSON.parse(abandoned.stdout).status).toBe("abandoned");
      expect(yield* fixture.runStore.getRunById(fixture.validationRunId)).toMatchObject({
        state: "complete",
        outcome: "tooling_failed",
      });
    }),
  );

  it.effect("rejects completion outcomes that are not established by persisted evidence", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.recordWorkspaceCleanup({
        validationRunId: fixture.validationRunId,
        cleanupWorkspace: "not_created",
      });

      for (const outcome of ["passed", "blocked"] as const) {
        expect(
          yield* fixture.runStore
            .complete({ validationRunId: fixture.validationRunId, outcome })
            .pipe(Effect.flip),
        ).toBeInstanceOf(RepositoryPersistedDataInvalid);
      }

      yield* fixture.recordRunToolingFailure("Snapshot Workspace setup did not start phases");
      yield* fixture.runStore.complete({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
      });
      expect(yield* fixture.runStore.getRunById(fixture.validationRunId)).toMatchObject({
        state: "complete",
        outcome: "tooling_failed",
      });
    }),
  );

  it.effect("rejects reviewer passing evidence without an Agent Invocation", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture({ linked: true });
      yield* fixture.runStore.recordPrepareResult({
        validationRunId: fixture.validationRunId,
        outcome: "passed",
        artifactRecords: [],
      });
      for (const check of policy.checks) {
        yield* fixture.runStore.recordCheckResult({
          validationRunId: fixture.validationRunId,
          producer: check.id,
          outcome: "passed",
          artifactRecords: [],
        });
      }
      expect(
        yield* fixture.runStore
          .recordAcceptanceResult({
            validationRunId: fixture.validationRunId,
            outcome: "passed",
            findings: [],
            artifactRecords: [],
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);

      yield* fixture.setPassingAcceptanceResultWithoutInvocation();
      yield* fixture.runStore.recordWorkspaceCleanup({
        validationRunId: fixture.validationRunId,
        cleanupWorkspace: "not_created",
      });
      expect(
        yield* fixture.runStore
          .complete({ validationRunId: fixture.validationRunId, outcome: "passed" })
          .pipe(Effect.flip),
      ).toBeInstanceOf(RepositoryPersistedDataInvalid);

      yield* fixture.setValidationRunPassedWithoutEvidence();
      expect(yield* fixture.getCurrentPassingEvidence().pipe(Effect.flip)).toBeInstanceOf(
        RepositoryPersistedDataInvalid,
      );
    }),
  );

  it.effect("rejects manufactured passing evidence during publication reads", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.setValidationRunPassedWithoutEvidence();
      const error = yield* fixture.getCurrentPassingEvidence().pipe(Effect.flip);
      expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
    }),
  );

  it.effect("derives abandonment identity from the Validation Run Candidate", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.recordWorkspaceCleanup({
        validationRunId: fixture.validationRunId,
        cleanupWorkspace: "not_created",
      });

      expect(yield* fixture.runStore.getAbandonmentContext(fixture.validationRunId)).toEqual({
        validationRunId: fixture.validationRunId,
        changeId: fixture.changeId,
        candidateId: fixture.candidateId,
        submittedSha: "head-sha",
      });
    }),
  );

  it.effect("rejects a second Active Validation Run and clears the relation on completion", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      const second = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });
      expect(second.reused).toBe(false);
      if (!("active" in second) || !second.active)
        throw new Error("Expected an Active Validation Run");
      expect(second.validationRunId).toBe(fixture.validationRunId);

      yield* fixture.recordRunToolingFailure("Complete the first Validation Run");
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
      });
      const third = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });
      expect(third.reused).toBe(false);
      if ("blocked" in third) throw new Error("Expected a new Validation Run");
      expect(third.validationRunId).not.toBe(fixture.validationRunId);
    }),
  );

  it.effect("reuses the latest passing judgment after Change authority history advances", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.recordPassingResults(fixture.validationRunId);
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "passed",
      });
      yield* fixture.recordDecision(
        "Keep rationale separate from intent",
        "Preserve rationale separately from approved intent.",
      );

      const reused = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });

      expect(reused).toEqual({
        reused: true,
        validationRunId: fixture.validationRunId,
        outcome: "passed",
      });
    }),
  );

  it.effect("makes an unlinked passing Run historical after a later Resolution", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.recordPassingResults(fixture.validationRunId);
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "passed",
      });
      expect(yield* fixture.getCurrentPassingEvidence()).toMatchObject({
        validationRunId: fixture.validationRunId,
      });

      yield* fixture.raiseBlocker();
      expect(yield* fixture.getCurrentPassingEvidence()).toMatchObject({
        validationRunId: fixture.validationRunId,
      });
      expect(yield* fixture.getCompletedPassingEvidence()).toMatchObject({
        validationRunId: fixture.validationRunId,
      });

      yield* fixture.resolveBlocker();

      expect(yield* fixture.getCurrentPassingEvidence()).toBeUndefined();
      expect(yield* fixture.getCompletedPassingEvidence()).toBeUndefined();
      const started = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });
      expect(started.reused).toBe(false);
      if ("blocked" in started) throw new Error("Expected a new Validation Run");
      expect(started.validationRunId).not.toBe(fixture.validationRunId);
    }),
  );

  it.effect("keeps a linked passing Run eligible after a later Resolution", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture({ linked: true });
      yield* fixture.recordPassingResults(fixture.validationRunId);
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "passed",
      });

      yield* fixture.raiseBlocker();
      yield* fixture.resolveBlocker();

      expect(yield* fixture.getCurrentPassingEvidence()).toMatchObject({
        validationRunId: fixture.validationRunId,
      });
      expect(yield* fixture.getCompletedPassingEvidence()).toMatchObject({
        validationRunId: fixture.validationRunId,
      });
      const reused = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });
      expect(reused).toEqual({
        reused: true,
        validationRunId: fixture.validationRunId,
        outcome: "passed",
      });
    }),
  );

  it.effect("snapshots Implementation Decisions in a new Validation Run", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.recordRunToolingFailure("Create a later Validation Run");
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
      });
      const decision = {
        choice: "Keep rationale separate from intent",
        rationale: "Preserve rationale separately from approved intent.",
      };
      yield* fixture.recordDecision(decision.choice, decision.rationale);
      const first = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });
      expect(first.reused).toBe(false);
      if ("blocked" in first) throw new Error("Expected a new Validation Run");
      const stored = yield* fixture.runStore.getRunById(first.validationRunId);
      expect(stored?.implementationDecisions).toEqual([
        expect.objectContaining({
          changeId: fixture.changeId,
          choice: decision.choice,
          rationale: decision.rationale,
        }),
      ]);
    }),
  );

  it.effect("shows the Candidate judgment and ordered evidence with bounded previews", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      const longContent = "x".repeat(1_200);

      yield* fixture.runStore.recordPrepareResult({
        validationRunId: fixture.validationRunId,
        outcome: "passed",
        artifactRecords: [fixture.artifact("prepare", "prepare", "logs.txt", "prepare complete\n")],
      });
      yield* fixture.runStore.recordCheckResult({
        validationRunId: fixture.validationRunId,
        producer: "types",
        outcome: "failed",
        artifactRecords: [
          fixture.artifact("checks", "types", "logs.txt", "types failed\n"),
          fixture.artifact("checks", "types", "stdout.txt", longContent),
        ],
        finding: {
          validationRunId: fixture.validationRunId,
          phase: "checks",
          producer: "types",
          title: "Check failed: types",
          description: "Configured check types exited with code 1.",
          evidence: "command: pnpm typecheck\nexitCode: 1",
          files: ["src/main.ts"],
          artifactRefs: [`artifact:${fixture.validationRunId}/checks/types/stdout.txt`],
        },
        toolingFailure: {
          validationRunId: fixture.validationRunId,
          errorKind: "check_command_execution_tooling_failed",
          operationName: "run_types",
          errorMessage: "Types process failed.",
        },
      });
      yield* fixture.runStore.recordCheckResult({
        validationRunId: fixture.validationRunId,
        producer: "tests",
        outcome: "failed",
        artifactRecords: [fixture.artifact("checks", "tests", "stderr.txt", "")],
        finding: {
          validationRunId: fixture.validationRunId,
          phase: "checks",
          producer: "tests",
          title: "Check failed: tests",
          description: "Configured check tests exited with code 1.",
          evidence: "command: pnpm test\nexitCode: 1",
          files: ["test/main.test.ts"],
          artifactRefs: [],
        },
        toolingFailure: {
          validationRunId: fixture.validationRunId,
          errorKind: "check_command_execution_tooling_failed",
          operationName: "run_tests",
          errorMessage: "Tests process failed.",
        },
      });
      yield* fixture.runStore.recordToolingFailure({
        validationRunId: fixture.validationRunId,
        errorKind: "snapshot_workspace_setup_failed",
        operationName: "cleanup_snapshot_workspace",
        errorMessage: "Could not remove worktree.",
      });
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
      });

      const result = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "show",
        String(fixture.validationRunId),
      ]);

      expect(result.status).toBe(0);
      const shown = JSON.parse(result.stdout);
      expect(shown).toMatchObject({
        validationRun: {
          id: fixture.validationRunId,
          candidateId: fixture.candidateId,
          state: "complete",
          outcome: "tooling_failed",
        },
        change: {
          id: fixture.changeId,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          state: "open",
        },
        candidate: {
          id: fixture.candidateId,
          changeId: fixture.changeId,
          changeBaseSha: "target-sha",
          headSha: "head-sha",
        },
        workspace: { cleanup: "complete", blockingReason: null },
        phases: [
          { phase: "prepare", results: [{ producer: "prepare", outcome: "passed" }] },
          {
            phase: "checks",
            results: [
              { producer: "types", outcome: "failed" },
              { producer: "tests", outcome: "failed" },
            ],
          },
          { phase: "acceptance_review", results: [] },
          { phase: "specialist_review", results: [] },
        ],
        findings: [
          { title: "Check failed: types", source: "checks/types" },
          { title: "Check failed: tests", source: "checks/tests" },
        ],
        toolingFailures: [
          { operationName: "run_types" },
          { operationName: "run_tests" },
          { operationName: "cleanup_snapshot_workspace" },
        ],
        agentInvocations: [],
      });
      expect(shown.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: `artifact:${fixture.validationRunId}/prepare/prepare/logs.txt`,
          }),
          expect.objectContaining({
            ref: `artifact:${fixture.validationRunId}/checks/types/stdout.txt`,
            preview: expect.objectContaining({ bytes: 1_000, truncated: true }),
          }),
        ]),
      );
      expect(
        shown.artifacts.map(
          (artifact: { phase: string; producer: string }) =>
            `${artifact.phase}/${artifact.producer}`,
        ),
      ).toEqual(["prepare/prepare", "checks/types", "checks/types", "checks/tests"]);

      const artifactRef = `artifact:${fixture.validationRunId}/checks/types/stdout.txt`;
      const detail = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "artifact",
        String(fixture.validationRunId),
        artifactRef,
      ]);
      expect(detail.status).toBe(0);
      expect(JSON.parse(detail.stdout)).toMatchObject({
        artifact: { ref: artifactRef, storedBytes: 1_200 },
        content: longContent,
      });
    }),
  );

  it.effect("joins Change reviewer configuration without adding it to the Run policy", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture({ linked: true });
      yield* fixture.recordRunToolingFailure("Replace the reviewer policy fixture");
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
      });
      const reviewPolicy = {
        acceptanceReview: {
          instructions: "Review intent",
          instructionsSource: "built_in",
          profile: {
            agentProfile: "acceptance",
            scope: "global",
            profile: {
              agentRuntime: "pi",
              runtimeConfig: { model: "acceptance-model" },
            },
          },
        },
        specialistReviews: [
          {
            id: "standards",
            instructions: "Review standards.",
            instructionsSource: "repo",
            profile: {
              agentProfile: "standards",
              scope: "repo",
              profile: {
                agentRuntime: "pi",
                runtimeConfig: { model: "standards-model" },
              },
            },
          },
        ],
      } as const;
      yield* fixture.setReviewerConfiguration({
        acceptanceReview: reviewPolicy.acceptanceReview,
        specialistReviews: reviewPolicy.specialistReviews,
      });
      const started = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
      });
      expect(started.reused).toBe(false);
      if ("blocked" in started) throw new Error("Expected a new Validation Run");
      yield* fixture.runStore.recordPrepareResult({
        validationRunId: started.validationRunId,
        outcome: "passed",
        artifactRecords: [],
      });
      for (const check of policy.checks) {
        yield* fixture.runStore.recordCheckResult({
          validationRunId: started.validationRunId,
          producer: check.id,
          outcome: "passed",
          artifactRecords: [],
        });
      }
      yield* fixture.recordReviewerResult(
        started.validationRunId,
        "acceptance_review",
        "acceptance",
        reviewPolicy.acceptanceReview,
      );
      yield* fixture.recordReviewerResult(
        started.validationRunId,
        "specialist_review",
        "standards",
        reviewPolicy.specialistReviews[0],
      );
      yield* fixture.runStore.completeAfterCleanup({
        validationRunId: started.validationRunId,
        outcome: "passed",
      });

      const result = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "show",
        String(started.validationRunId),
      ]);
      expect(result.status).toBe(0);
      const shown = JSON.parse(result.stdout);
      expect(shown.reviewerConfiguration).toBeUndefined();
      expect(shown.change.reviewerConfiguration).toEqual(reviewPolicy);
    }),
  );

  it.effect("keeps empty evidence distinct from unavailable artifact content", () =>
    Effect.gen(function* () {
      const empty = yield* candidateValidationFixture();
      yield* empty.runStore.recordPrepareResult({
        validationRunId: empty.validationRunId,
        outcome: "passed",
        artifactRecords: [empty.artifact("prepare", "prepare", "logs.txt", "prepare complete\n")],
      });

      const emptyResult = yield* runByInProcessEffect(empty.root, [
        "validation-run",
        "show",
        String(empty.validationRunId),
      ]);
      expect(emptyResult.status).toBe(0);
      expect(JSON.parse(emptyResult.stdout)).toMatchObject({
        phases: [
          {
            phase: "prepare",
            results: [
              {
                validationRunId: empty.validationRunId,
                phase: "prepare",
                producer: "prepare",
                outcome: "passed",
              },
            ],
          },
          { phase: "checks", results: [] },
          { phase: "acceptance_review", results: [] },
          { phase: "specialist_review", results: [] },
        ],
        findings: [],
        toolingFailures: [],
        artifacts: [
          {
            ref: `artifact:${empty.validationRunId}/prepare/prepare/logs.txt`,
            validationRunId: empty.validationRunId,
            phase: "prepare",
            producer: "prepare",
            path: `${empty.validationRunId}/prepare/prepare/logs.txt`,
            originalBytes: 17,
            storedBytes: 17,
            truncated: false,
            detailCommand: `by validation-run artifact ${empty.validationRunId} artifact:${empty.validationRunId}/prepare/prepare/logs.txt`,
          },
        ],
      });

      const unavailable = yield* candidateValidationFixture();
      const missing = unavailable.artifact("checks", "types", "stdout.txt", "missing");
      yield* unavailable.runStore.recordCheckResult({
        validationRunId: unavailable.validationRunId,
        producer: "types",
        outcome: "passed",
        artifactRecords: [missing],
      });
      rmSync(join(unavailable.artifactsRoot, missing.path));

      const unavailableResult = yield* runByInProcessEffect(unavailable.root, [
        "validation-run",
        "show",
        String(unavailable.validationRunId),
      ]);
      expect(unavailableResult.status).toBe(0);
      expect(JSON.parse(unavailableResult.stdout).artifacts[0]).toEqual({
        ref: missing.ref,
        validationRunId: unavailable.validationRunId,
        phase: "checks",
        producer: "types",
        path: missing.path,
        originalBytes: 7,
        storedBytes: 7,
        truncated: false,
        detailCommand: `by validation-run artifact ${unavailable.validationRunId} ${missing.ref}`,
      });

      const unknownRun = yield* runByInProcessEffect(unavailable.root, [
        "validation-run",
        "show",
        "128",
      ]);
      const unknownArtifact = yield* runByInProcessEffect(unavailable.root, [
        "validation-run",
        "artifact",
        String(unavailable.validationRunId),
        "missing-artifact",
      ]);
      const unavailableContent = yield* runByInProcessEffect(unavailable.root, [
        "validation-run",
        "artifact",
        String(unavailable.validationRunId),
        missing.ref,
      ]);

      expect(JSON.parse(unknownRun.stdout)).toMatchObject({
        error: { code: "validation_run_not_found", validationRunId: 128 },
        help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
      });
      expect(JSON.parse(unknownArtifact.stdout)).toMatchObject({
        error: {
          code: "artifact_not_found",
          validationRunId: unavailable.validationRunId,
          artifactRef: "missing-artifact",
        },
        help: [
          `Run \`by validation-run show ${unavailable.validationRunId}\` to list known Artifacts.`,
        ],
      });
      expect(JSON.parse(unavailableContent.stdout)).toMatchObject({
        error: {
          code: "artifact_content_unavailable",
          validationRunId: unavailable.validationRunId,
          artifactRef: missing.ref,
        },
        help: [
          `Run \`by validation-run show ${unavailable.validationRunId}\` to inspect the recorded metadata.`,
        ],
      });
      expect([unknownRun.status, unknownArtifact.status, unavailableContent.status]).toEqual([
        1, 1, 1,
      ]);
    }),
  );
});

const candidateValidationFixture = (options: { readonly linked?: boolean } = {}) =>
  Effect.gen(function* () {
    const root = yield* cloneInitializedTestRepository(candidateValidationRepoTemplate);
    const commonDirectory = join(root, ".git");
    const artifactsRoot = join(commonDirectory, "but-why", "artifacts");
    const repositoryLayer = repositorySqlLayer({
      statePath: join(commonDirectory, "but-why", "state.sqlite"),
      commonDirectory,
    });
    const withPersistence = <A, E>(
      use: (persistence: ChangeValidationTestDependencies) => Effect.Effect<A, E>,
    ) =>
      Effect.flatMap(openSqliteChangeValidationTestDependencies(), use).pipe(
        Effect.provide(repositoryLayer),
      );
    const withRepository = <A, E>(program: Effect.Effect<A, E, RepositorySql>) =>
      program.pipe(Effect.provide(repositoryLayer));
    const initialAcceptanceContext = options.linked
      ? JSON.stringify(linkedAcceptanceContext)
      : null;
    const fixtureReviewerConfiguration = options.linked
      ? reviewerConfiguration
      : unlinkedReviewerConfiguration;
    yield* withTestRepository(
      root,
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        if (options.linked) {
          yield* repository.operation(
            "create linked Task fixture",
            (sql) => sql`
              INSERT INTO tasks (id, title, description, state)
              VALUES (
                1, ${linkedAcceptanceContext.title},
                ${linkedAcceptanceContext.description}, 'todo'
              )
            `,
          );
        }
        yield* repository.operation(
          "create Candidate-owning Change",
          (sql) => sql`
          INSERT INTO changes (
            branch_ref, base_ref, base_remote_url, worktree_path,
            initial_acceptance_context, reviewer_configuration,
            prepare_definition, checks_definition, cleanup_pending
          ) VALUES (
            'refs/heads/feature', 'refs/remotes/origin/main',
            'https://example.com/acme/repo.git', ${root},
            ${initialAcceptanceContext}, ${JSON.stringify(fixtureReviewerConfiguration)},
            ${JSON.stringify(policy.prepare)}, ${JSON.stringify(policy.checks)}, 0
          )
        `,
        );
        if (options.linked) {
          yield* repository.operation(
            "link Change fixture to its Task",
            (sql) => sql`
              INSERT INTO task_change_links (task_id, change_id)
              SELECT 1, id FROM changes WHERE branch_ref = 'refs/heads/feature'
            `,
          );
        }
      }),
    );
    const candidateResult = yield* openSqliteCandidateCapturePersistence().pipe(
      Effect.flatMap((capture) =>
        capture.commitCapture({
          repositoryCommonDirectory: commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "target-sha",
          headSha: "head-sha",
        }),
      ),
      Effect.provide(repositoryLayer),
    );
    if (!candidateResult.ok) throw new Error(candidateResult.code);
    const runResult = yield* withPersistence((persistence) =>
      persistence.execution.startOrReuse({
        candidateId: candidateResult.candidateId,
        headSha: "head-sha",
      }),
    );
    if (runResult.reused) throw new Error("Expected a new Validation Run");
    if ("blocked" in runResult) throw new Error("Expected a new Validation Run");

    const artifact = (
      phase: "prepare" | "checks" | "acceptance_review",
      producer: string,
      fileName: string,
      content: string,
    ) => {
      const path = join(String(runResult.validationRunId), phase, producer, fileName);
      mkdirSync(join(artifactsRoot, String(runResult.validationRunId), phase, producer), {
        recursive: true,
      });
      writeFileSync(join(artifactsRoot, path), content);
      const bytes = Buffer.byteLength(content);
      return {
        ref: `artifact:${runResult.validationRunId}/${phase}/${producer}/${fileName}`,
        validationRunId: runResult.validationRunId,
        phase,
        producer,
        path,
        originalBytes: bytes,
        storedBytes: bytes,
        truncated: false,
      };
    };
    const recordDecision = (choice: string, rationale: string) =>
      openSqliteChangeTestDependencies().pipe(
        Effect.flatMap((changes) =>
          changes.authority.recordImplementationDecision({
            changeId: candidateResult.changeId,
            choice,
            rationale,
            now,
          }),
        ),
        Effect.provide(repositoryLayer),
      );
    const runStore = {
      startOrReuse: (
        input: Parameters<ChangeValidationTestDependencies["execution"]["startOrReuse"]>[0],
      ) => withPersistence((persistence) => persistence.execution.startOrReuse(input)),
      getRunById: (runId: number) =>
        withPersistence((persistence) => persistence.reads.getRunById(runId)),
      recordPrepareResult: (
        input: Parameters<ChangeValidationTestDependencies["execution"]["recordPrepareResult"]>[0],
      ) => withPersistence((persistence) => persistence.execution.recordPrepareResult(input)),
      recordCheckResult: (
        input: Parameters<ChangeValidationTestDependencies["execution"]["recordCheckResult"]>[0],
      ) => withPersistence((persistence) => persistence.execution.recordCheckResult(input)),
      recordAcceptanceResult: (
        input: Parameters<
          ChangeValidationTestDependencies["execution"]["recordAcceptanceResult"]
        >[0],
      ) => withPersistence((persistence) => persistence.execution.recordAcceptanceResult(input)),
      recordSpecialistResult: (
        input: Parameters<
          ChangeValidationTestDependencies["execution"]["recordSpecialistResult"]
        >[0],
      ) => withPersistence((persistence) => persistence.execution.recordSpecialistResult(input)),
      recordToolingFailure: (
        input: Parameters<ChangeValidationTestDependencies["execution"]["recordToolingFailure"]>[0],
      ) => withPersistence((persistence) => persistence.execution.recordToolingFailure(input)),
      recordWorkspaceCleanup: (
        input: Parameters<
          ChangeValidationTestDependencies["execution"]["recordWorkspaceCleanup"]
        >[0],
      ) => withPersistence((persistence) => persistence.execution.recordWorkspaceCleanup(input)),
      getAbandonmentContext: (runId: number) =>
        withPersistence((persistence) => persistence.abandonment.getAbandonmentContext(runId)),
      complete: (input: Parameters<ChangeValidationTestDependencies["execution"]["complete"]>[0]) =>
        withPersistence((persistence) => persistence.execution.complete(input)),
      completeAfterCleanup: (
        input: Parameters<ChangeValidationTestDependencies["execution"]["complete"]>[0],
      ) =>
        withPersistence((persistence) =>
          Effect.zipRight(
            persistence.execution.recordWorkspaceCleanup({
              validationRunId: input.validationRunId,
              cleanupWorkspace: "not_created",
            }),
            persistence.execution.complete(input),
          ),
        ),
    };

    const recordReviewerResult = (
      validationRunId: number,
      phase: "acceptance_review" | "specialist_review",
      producer: string,
      reviewer: ChangeReviewerPolicy,
    ) =>
      withPersistence((persistence) =>
        Effect.gen(function* () {
          const started = yield* persistence.agentPersistence.beginInvocation({
            configuration: {
              harness: "pi",
              provider: null,
              model: reviewer.profile.profile.runtimeConfig.model,
              thinking: reviewer.profile.profile.runtimeConfig.thinking ?? null,
            },
            createdAt: now,
            linkInvocation: persistence.agentSessions.linkAgentInvocation({
              changeId: candidateResult.changeId,
              producer,
              validationRunId,
              phase,
              configurationSnapshot: reviewer,
            }),
          });
          if (!started.ok) throw new Error(started.code);
          yield* persistence.agentPersistence.settleInvocation({
            invocationId: started.dispatch.invocation.id,
            continuationId: started.dispatch.continuation.id,
            settlement: { settledAt: later, kind: "returned" },
            settleDomain: persistence.execution.settleAgentInvocationResult({
              validationRunId,
              phase,
              producer,
              outcome: "passed",
              findings: [],
              artifactRecords: [],
            }),
          });
        }),
      );
    const recordRunToolingFailure = (errorMessage: string) =>
      runStore.recordToolingFailure({
        validationRunId: runResult.validationRunId,
        errorKind: "snapshot_workspace_setup_failed",
        operationName: "set_up_snapshot_workspace",
        errorMessage,
      });
    const recordPassingResults = (validationRunId: number) =>
      withPersistence((persistence) =>
        Effect.gen(function* () {
          yield* persistence.execution.recordPrepareResult({
            validationRunId,
            outcome: "passed",
            artifactRecords: [],
          });
          for (const check of policy.checks) {
            yield* persistence.execution.recordCheckResult({
              validationRunId,
              producer: check.id,
              outcome: "passed",
              artifactRecords: [],
            });
          }
          if (fixtureReviewerConfiguration.acceptanceReview !== null) {
            yield* recordReviewerResult(
              validationRunId,
              "acceptance_review",
              "acceptance",
              fixtureReviewerConfiguration.acceptanceReview,
            );
          }
        }),
      );
    const getCurrentPassingEvidence = () =>
      openSqliteChangeTestDependencies().pipe(
        Effect.flatMap((changes) =>
          changes.authority.getCurrentPassingEvidence(candidateResult.changeId),
        ),
        Effect.provide(repositoryLayer),
      );
    const getCompletedPassingEvidence = () =>
      openSqliteChangeTestDependencies().pipe(
        Effect.flatMap((changes) =>
          changes.submission.getCompletedPublicationEvidence(
            candidateResult.changeId,
            candidateResult.candidateId,
            runResult.validationRunId,
          ),
        ),
        Effect.provide(repositoryLayer),
      );
    const raiseBlocker = () =>
      openSqliteChangeTestDependencies().pipe(
        Effect.flatMap((changes) =>
          changes.authority.raiseImplementationBlocker({
            changeId: candidateResult.changeId,
            content: "Decide how to continue.",
            now,
          }),
        ),
        Effect.provide(repositoryLayer),
      );
    const resolveBlocker = () =>
      openSqliteChangeTestDependencies().pipe(
        Effect.flatMap((changes) =>
          changes.authority.resolveImplementationBlocker({
            changeId: candidateResult.changeId,
            content: "Continue under the approved resolution.",
            now: later,
          }),
        ),
        Effect.provide(repositoryLayer),
      );
    const setPassingAcceptanceResultWithoutInvocation = () =>
      withRepository(
        Effect.flatMap(RepositorySql, (repository) =>
          repository.operation(
            "manufacture Acceptance Review evidence fixture",
            (sql) => sql`
              INSERT INTO validation_phase_results (
                validation_run_id, phase, producer, outcome, findings, artifacts, tooling_failure
              ) VALUES (
                ${runResult.validationRunId}, 'acceptance_review', 'acceptance',
                'passed', '[]', '[]', NULL
              )
            `,
          ),
        ),
      );
    const setValidationRunPassedWithoutEvidence = () =>
      withRepository(
        Effect.flatMap(RepositorySql, (repository) =>
          repository.operation(
            "manufacture passing Validation evidence fixture",
            (sql) => sql`
              UPDATE validation_runs SET outcome = 'passed', cleanup_pending = 0
              WHERE id = ${runResult.validationRunId}
            `,
          ),
        ),
      );
    const setReviewerConfiguration = (configuration: unknown) =>
      withRepository(
        Effect.flatMap(RepositorySql, (repository) =>
          repository.operation(
            "replace Change reviewer fixture",
            (sql) => sql`
              UPDATE changes SET reviewer_configuration = ${JSON.stringify(configuration)}
              WHERE id = 1
            `,
          ),
        ),
      );

    return {
      root,
      runStore,
      recordRunToolingFailure,
      recordReviewerResult,
      recordPassingResults,
      getCurrentPassingEvidence,
      getCompletedPassingEvidence,
      raiseBlocker,
      resolveBlocker,
      setPassingAcceptanceResultWithoutInvocation,
      setValidationRunPassedWithoutEvidence,
      setReviewerConfiguration,
      artifactsRoot,
      artifact,
      validationRunId: runResult.validationRunId,
      candidateId: candidateResult.candidateId,
      changeId: candidateResult.changeId,
      recordDecision,
    };
  });
