import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe } from "vitest";
import { createPiReviewerProcessExecutor } from "../../src/agent/adapters/piReviewerProcessExecutor.js";
import { shellQuote } from "../../src/agent/agentEnvironment.js";
import { openSqliteAgentSessionPersistence } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../src/agent/reviewerExecution.js";
import type {
  CaptureLocalCandidateInput,
  CaptureLocalCandidateResult,
} from "../../src/change/candidateCapture/captureLocalCandidate.js";
import { CandidateValidation } from "../../src/change/candidateValidation/validateCandidate.js";
import type { ChangeRecord } from "../../src/change/change.js";
import type { ChangeSubmissionPort } from "../../src/change/changePorts.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestReader,
} from "../../src/change/ownedPullRequestGateway.js";
import type {
  PublishCandidateInput,
  PublishCandidateResult,
} from "../../src/change/publication/candidatePublication.js";
import type { StallDetectionService } from "../../src/change/runStallDetection.js";
import { makeStallDetectionService } from "../../src/change/runStallDetection.js";
import type { StallDetectionAssessment } from "../../src/change/stallDetection.js";
import { openChangeSubmit } from "../../src/change/submitChange.js";
import { type ExecutionLock, ExecutionLockUnavailable } from "../../src/contracts/executionLock.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openSqliteStallDetectionPersistence } from "../../src/sqlite/sqliteStallDetectionPersistence.js";
import type { RemoteChangeBaseResult } from "../../src/submissionEnvironment/remoteChangeBase.js";
import { withTemporaryRepositoryState } from "../support/repository.js";
import { runTestProcess } from "../support/testProcess.js";

const now = "2026-06-30T12:00:00.000Z";
const candidate = {
  ok: true,
  changeId: "change-1",
  candidateId: 1,
  branchRef: "refs/heads/change-1",
  changeBaseSha: "base",
  headSha: "head",
  trackedTreeMatchesChangeBase: false,
} as const;
const changeWithoutTaskPolicy = {
  checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
} as const;
const storedAcceptanceReviewer = {
  instructions: "Review intent",
  instructionsSource: "built_in" as const,
  profile: {
    agentProfile: "default",
    scope: "global" as const,
    profile: { agentRuntime: "pi" as const, runtimeConfig: { model: "test/model" } },
  },
};

describe("Change Submit orchestration", () => {
  it.effect("reports the exact Active Validation Run rejected at start-or-reuse", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(dependencies({ events, change: readyChange() }));
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () =>
          Effect.succeed({
            ok: false as const,
            code: "active_validation_run" as const,
            validationRunId: 102,
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "active_validation_run",
        changeId: "change-1",
        validationRunId: 102,
      });
      expect(events).toEqual(["capture", "detect_target"]);
    }),
  );

  it.effect("rejects a concurrent Submit before it reads Change state", () =>
    Effect.gen(function* () {
      let lockCalls = 0;
      const lock: ExecutionLock = {
        withLock: () => {
          lockCalls += 1;
          return Effect.fail(
            new ExecutionLockUnavailable({
              owner: "change_submission",
              key: "change-1",
              lockPath: "/tmp/change-1.sqlite",
              cause: new Error("busy"),
            }),
          );
        },
      };
      const submit = openChangeSubmit(
        dependencies({ events: [], change: readyChange(), executionLock: lock }),
      );
      const result = yield* submit.submit({ changeId: "change-1", now }).pipe(
        Effect.provide(
          Layer.succeed(CandidateValidation, {
            validateCandidate: () => Effect.die("Validation must not start"),
            validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
            listFindings: () => Effect.succeed([]),
            listToolingFailures: () => Effect.succeed([]),
            listPhaseResults: () => Effect.succeed([]),
          }),
        ),
      );

      expect(result).toEqual({
        ok: false,
        code: "submission_in_progress",
        changeId: "change-1",
        validationRunId: null,
      });
      expect(lockCalls).toBe(1);
    }),
  );

  it.effect("requires and then reuses a restored frozen Global reviewer resource", () => {
    const globalConfigDirectory = mkdtempSync(join(tmpdir(), "by-submit-resource-"));
    const extensionDirectory = join(globalConfigDirectory, "extensions");
    const extensionPath = join(extensionDirectory, "review.ts");
    const events: string[] = [];
    const change = readyChange({
      policy: {
        reviewerConfiguration: {
          acceptanceReview: {
            ...storedAcceptanceReviewer,
            profile: {
              ...storedAcceptanceReviewer.profile,
              globalConfigDirectory,
              profile: {
                agentRuntime: "pi",
                runtimeConfig: {
                  model: "test/model",
                  extensions: ["extensions/review.ts"],
                },
              },
            },
          },
          specialistReviews: [],
        },
        stallDetection: { enabled: false, profile: null },
        prepare: null,
        checks: changeWithoutTaskPolicy.checks,
      },
    });
    const submit = openChangeSubmit(dependencies({ events, change }));
    const validationLayer = Layer.succeed(CandidateValidation, {
      validateCandidate: () =>
        Effect.sync(() => {
          events.push("validate");
          return {
            ok: true,
            reused: false,
            validationRunId: 1,
            outcome: "passed",
          } as const;
        }),
      validateAcceptanceContextCandidate: () =>
        Effect.die("Acceptance Context validation was not expected"),
      listFindings: () => Effect.succeed([]),
      listToolingFailures: () => Effect.succeed([]),
      listPhaseResults: () => Effect.succeed([]),
    });

    return Effect.gen(function* () {
      const missing = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      expect(missing).toMatchObject({
        ok: false,
        code: "validation_policy_invalid",
        message: expect.stringContaining(extensionPath),
      });
      expect(events).not.toContain("validate");
      expect(events).not.toContain("publish");

      mkdirSync(extensionDirectory);
      writeFileSync(extensionPath, "export default {};\n");
      const restored = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      expect(restored).toMatchObject({ ok: true, status: "published" });
      expect(events).toContain("validate");
      expect(events).toContain("publish");
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(globalConfigDirectory, { recursive: true }))));
  });

  it.effect(
    "uses the Agent Environment to validate and publish a passing Change without a Task Candidate",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const submit = openChangeSubmit(
          dependencies({
            events,
            change: readyChange({
              policy: {
                reviewerConfiguration: {
                  acceptanceReview: storedAcceptanceReviewer,
                  specialistReviews: [],
                  agentEnvironment: ["nix", "develop", "-c"],
                },
                stallDetection: { enabled: false, profile: null },
                prepare: null,
                checks: changeWithoutTaskPolicy.checks,
              },
            }),
            publication: {
              publish: () => {
                events.push("publish");
                return {
                  ok: true,
                  created: true,
                  pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
                };
              },
            },
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: (input) =>
            Effect.sync(() => {
              events.push("validate_changeWithoutTask");
              expect(input).not.toHaveProperty("policy");
              return {
                ok: true,
                reused: false,
                validationRunId: 1,
                outcome: "passed",
              } as const;
            }),
          validateAcceptanceContextCandidate: () =>
            Effect.die("Acceptance Review was not expected"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listPhaseResults: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: "change-1", now })
          .pipe(Effect.provide(validationLayer));

        expect(result).toEqual({
          ok: true,
          status: "published",
          changeId: "change-1",
          candidateId: 1,
          validationRunId: 1,
          created: true,
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        });
        expect(events).toEqual([
          "capture",
          "detect_target",
          "validate_changeWithoutTask",
          "publish",
        ]);
      }),
  );

  it.effect("publishes a Candidate without rerunning a recorded preparation failure", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        prepareFailure: {
          command: "just prepare",
          exitCode: 7,
          timedOut: false,
          stdout: "stdout excerpt",
          stderr: "stderr excerpt",
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          publication: {
            publish: () => {
              events.push("publish");
              return {
                ok: true,
                created: true,
                pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
              };
            },
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () =>
          Effect.sync(() => {
            events.push("validate_changeWithoutTask");
            return {
              ok: true,
              reused: false,
              validationRunId: 1,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({ ok: true, status: "published" });
      expect(events).toEqual(["capture", "detect_target", "validate_changeWithoutTask", "publish"]);
      expect(change.prepareFailure).toMatchObject({ exitCode: 7 });
    }),
  );

  it.effect("retries a pending publication for a newer Candidate through Submit", () =>
    Effect.gen(function* () {
      const publishedCandidates: number[] = [];
      const submit = openChangeSubmit(
        dependencies({
          change: readyChange({
            publication: {
              candidateId: 102,
              validationRunId: 105,
              target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
              headBranch: "change-1",
              expectedHeadSha: "old-head",
              pullRequest: null,
            },
          }),
          captureResults: [candidate, { ...candidate, candidateId: 2, headSha: "head-2" }],
          publication: {
            publish: (input) => {
              publishedCandidates.push(input.candidateId);
              return publishedCandidates.length === 1
                ? { ok: false as const, code: "publication_tooling_failed" as const }
                : {
                    ok: true as const,
                    created: false,
                    pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
                  };
            },
          },
        }),
      );
      let validationRuns = 0;
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () =>
          Effect.sync(() => {
            validationRuns += 1;
            return {
              ok: true,
              reused: false,
              validationRunId: validationRuns,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: false,
        code: "publication_tooling_failed",
      });
      expect(
        yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: true,
        status: "published",
        created: false,
      });
      expect(publishedCandidates).toEqual([1, 2]);
    }),
  );

  it.effect("runs fresh validation when the fetched Change Base target advances", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const headSha = "c0ebeaa730bcd666c7b927db2542ea6ea9d9575c";
      const oldTargetSha = "d5fbe76f5565fa4d7de3ee3c48135fc595b26bea";
      const newTargetSha = "b32245d73e2c2aaf9ed9d46270720591a6f62946";
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          refreshResults: [
            { ok: true, base: { ...refreshedBase, commit: oldTargetSha } },
            { ok: true, base: { ...refreshedBase, commit: newTargetSha } },
          ],
          captureResults: [
            {
              ...candidate,
              candidateId: 104,
              changeBaseSha: oldTargetSha,
              headSha,
            },
            {
              ...candidate,
              candidateId: 105,
              changeBaseSha: newTargetSha,
              headSha,
            },
          ],
        }),
      );
      const validatedCandidates: number[] = [];
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: (input) =>
          Effect.sync(() => {
            events.push("validate_changeWithoutTask");
            validatedCandidates.push(input.candidateId);
            return {
              ok: true,
              reused: false,
              validationRunId: input.candidateId === 104 ? 202 : 201,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const oldTarget = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));
      const newTarget = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(oldTarget).toMatchObject({
        ok: true,
        candidateId: 104,
        validationRunId: 202,
      });
      expect(newTarget).toMatchObject({
        ok: true,
        candidateId: 105,
        validationRunId: 201,
      });
      expect(validatedCandidates).toEqual([104, 105]);
      expect(events).toEqual([
        "refresh_base",
        "capture",
        "detect_target",
        "validate_changeWithoutTask",
        "publish",
        "refresh_base",
        "capture",
        "detect_target",
        "validate_changeWithoutTask",
        "publish",
      ]);
    }),
  );

  it.effect("validates a revised Candidate before updating the same owned pull request", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      let seenPublishInput: PublishCandidateInput | undefined;
      let seenValidationInput: Readonly<Record<string, unknown>> | undefined;
      const change = readyChange({
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
        implementationDecisions: [
          {
            id: 1,
            changeId: "change-1",
            choice: "Keep the same owned pull request",
            rationale: "Preserve the existing owned pull request.",
          },
        ],
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          publication: {
            publish: (input) => {
              seenPublishInput = input;
              events.push("publish");
              return {
                ok: true,
                created: false,
                pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
              };
            },
          },
          branchHeadSha: "base",
          captureResult: {
            ...candidate,
            changeBaseSha: "base",
            headSha: "revised-head",
            trackedTreeMatchesChangeBase: false,
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
        validateAcceptanceContextCandidate: (input) =>
          Effect.sync(() => {
            seenValidationInput = input;
            events.push("validate_change_linked_to_task");
            return {
              ok: true,
              reused: false,
              validationRunId: 1,
              outcome: "passed",
            } as const;
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({ ok: true, status: "published", pullRequest: { number: 42 } });
      expect(seenPublishInput).toMatchObject({
        candidateId: 1,
        validationRunId: 1,
      });
      expect(seenValidationInput).toMatchObject({
        candidateId: 1,
      });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_change_linked_to_task",
        "publish",
      ]);
    }),
  );

  it.effect("validates a revised Candidate after observing only a stale publication head", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          observedPullRequest: {
            number: 42,
            url: "https://github.test/acme/repo/pull/42",
            repository: { owner: "acme", repo: "repo" },
            state: "open",
            merged: false,
            baseBranch: "main",
            headBranch: "change-1",
            headSha: "revised-head",
          },
          branchHeadSha: "revised-head",
          captureResult: {
            ...candidate,
            headSha: "revised-head",
            trackedTreeMatchesChangeBase: false,
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () =>
          Effect.sync(() => {
            events.push("validate_changeWithoutTask");
            return {
              ok: true,
              reused: false,
              validationRunId: 109,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: true,
        status: "published",
        candidateId: 1,
        validationRunId: 109,
      });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_changeWithoutTask",
        "publish",
      ]);
    }),
  );

  it.effect(
    "selects authority-backed validation for a Candidate from a Change linked to a Task",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const change = readyChange({
          acceptanceContext: {
            version: 1,
            title: "Approved intent",
            description: "Deliver it",
          },
        });
        const submit = openChangeSubmit(dependencies({ events, change }));
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
          validateAcceptanceContextCandidate: () =>
            Effect.sync(() => {
              events.push("validate_change_linked_to_task");
              return {
                ok: true,
                reused: false,
                validationRunId: 1,
                outcome: "passed",
              } as const;
            }),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listPhaseResults: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: change.id, now })
          .pipe(Effect.provide(validationLayer));

        expect(result.ok).toBe(true);
        expect(events).toEqual([
          "capture",
          "detect_target",
          "validate_change_linked_to_task",
          "publish",
        ]);
      }),
  );

  it.effect("completes an exact merged owned pull request through terminal completion", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const completeMergedInputs: Array<{ readonly changeId: string; readonly observed: unknown }> =
        [];
      const change = readyChange({
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          pullRequestObservation: "exact_merged",
          completeMergedInputs,
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: true,
        status: "completed",
        change: { id: change.id },
      });
      expect(events).toEqual(["observe_pull_request", "complete_merged_change"]);
      expect(completeMergedInputs).toEqual([
        {
          changeId: change.id,
          now,
          observed: {
            repository: { owner: "acme", repo: "repo" },
            pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
            baseBranch: "main",
            headBranch: "change-1",
            mergedHeadSha: "published-head",
            candidateId: 106,
            validationRunId: 108,
            expectedHeadSha: "published-head",
          },
        },
      ]);
    }),
  );

  it.effect("continues Candidate work through an exact closed-unmerged owned pull request", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          pullRequestObservation: "exact_closed_unmerged",
          publication: {
            publish: () => {
              events.push("publish");
              return {
                ok: true,
                created: false,
                pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
              };
            },
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () =>
          Effect.sync(() => {
            events.push("validate_changeWithoutTask");
            return {
              ok: true,
              reused: false,
              validationRunId: 1,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({ ok: true, status: "published", created: false });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_changeWithoutTask",
        "publish",
      ]);
    }),
  );

  it.effect("reopens a closed owned pull request before revising the same publication", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          pullRequestObservations: ["exact_closed_unmerged", "exact_open", "exact_open"],
          publication: {
            publish: (input) => {
              events.push(`publish:${input.candidateId}`);
              return {
                ok: true,
                created: false,
                pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
              };
            },
          },
          branchHeadSha: "base",
          captureResults: [
            { ...candidate, trackedTreeMatchesChangeBase: false },
            {
              ...candidate,
              candidateId: 2,
              headSha: "revised-head",
              trackedTreeMatchesChangeBase: false,
            },
          ],
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.sync(() => {
            events.push("validate_change_linked_to_task");
            return {
              ok: true,
              reused: false,
              validationRunId: 110,
              outcome: "passed",
            } as const;
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const first = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      const second = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(first).toMatchObject({
        ok: true,
        status: "published",
        created: false,
        pullRequest: { number: 42 },
      });
      expect(second).toMatchObject({
        ok: true,
        status: "published",
        created: false,
        pullRequest: { number: 42 },
      });
      expect(change.publication).toMatchObject({
        candidateId: 106,
        expectedHeadSha: "published-head",
      });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_change_linked_to_task",
        "publish:1",
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_change_linked_to_task",
        "publish:2",
      ]);
    }),
  );

  it.effect("rejects mismatched owned pull request identity facts before Candidate work", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          observedPullRequest: {
            number: 42,
            url: "https://github.test/acme/repo/pull/42",
            repository: { owner: "acme", repo: "repo" },
            state: "open",
            merged: false,
            baseBranch: "release",
            headBranch: "change-1",
            headSha: "published-head",
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: false,
        code: "reconciliation_rejected",
        change: { changeId: change.id, rejection: "base_branch_mismatch" },
      });
      expect(events).toEqual(["observe_pull_request"]);
    }),
  );

  it.effect("stops when owned pull request facts are unavailable", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: 106,
          validationRunId: 108,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "published-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          pullRequestObservation: "unavailable",
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: false,
        code: "owned_pull_request_unavailable",
        changeId: change.id,
        reason: "pull_request_unavailable",
      });
      expect(events).toEqual(["observe_pull_request"]);
    }),
  );

  it.effect("blocks Submission while an Implementation Blocker is unresolved", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        activeBlocker: {
          id: 1,
          changeId: "change-1",
          content: "Need an external decision.",
          resolution: null,
        },
        publication: {
          candidateId: 1,
          validationRunId: 1,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(dependencies({ events, change }));
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Blocked Submission must not validate"),
        validateAcceptanceContextCandidate: () =>
          Effect.die("Blocked Submission must not validate"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({ ok: false, code: "change_blocked" });
      expect(events).toEqual([]);
    }),
  );

  it.effect("returns completed publication before fetching the Change Base", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: 1,
          validationRunId: 1,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          refreshResult: {
            ok: false,
            code: "publication_remote_unreachable",
            remoteName: "origin",
          },
          publication: {
            publish: () => {
              throw new Error("Duplicate publication");
            },
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Duplicate validation"),
        validateAcceptanceContextCandidate: () => Effect.die("Duplicate validation"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({ ok: true, status: "published", created: false });
      expect(events).toEqual(["observe_pull_request", "read_publication_evidence"]);
    }),
  );

  it.effect("retries failed upstream association from completed publication evidence", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      let associationAttempts = 0;
      const change = readyChange({
        publication: {
          candidateId: 1,
          validationRunId: 1,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          refreshResult: {
            ok: false,
            code: "publication_remote_unreachable",
            remoteName: "origin",
          },
          publication: {
            publish: () => {
              throw new Error("Duplicate publication");
            },
            associatePublishedChange: () => {
              associationAttempts += 1;
              return associationAttempts === 1 ? { ok: false } : { ok: true };
            },
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Duplicate validation"),
        validateAcceptanceContextCandidate: () => Effect.die("Duplicate validation"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const first = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      const second = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(first).toEqual({
        ok: false,
        code: "repository_branch_upstream_association_failed",
      });
      expect(second).toMatchObject({ ok: true, status: "published", created: false });
      expect(associationAttempts).toBe(2);
      expect(events).toEqual([
        "observe_pull_request",
        "read_publication_evidence",
        "observe_pull_request",
        "read_publication_evidence",
      ]);
    }),
  );

  it.effect("does not reuse publication when only the Repository Branch head matches", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: 107,
          validationRunId: 111,
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          publicationEvidence: null,
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () =>
          Effect.sync(() => {
            events.push("validate_changeWithoutTask");
            return {
              ok: true,
              reused: false,
              validationRunId: 112,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({
        ok: true,
        status: "published",
        candidateId: 1,
        validationRunId: 112,
      });
      expect(events).toEqual([
        "observe_pull_request",
        "read_publication_evidence",
        "capture",
        "detect_target",
        "validate_changeWithoutTask",
        "publish",
      ]);
    }),
  );

  it.effect.each([
    {
      name: "unchanged work without a Task",
      captureResult: {
        ...candidate,
        headSha: "base",
        trackedTreeMatchesChangeBase: true,
      } as CaptureLocalCandidateResult,
      expected: { ok: true, status: "nothing_to_submit", changeId: "change-1" },
    },
    {
      name: "dirty work",
      captureResult: { ok: false, code: "dirty_work" } as CaptureLocalCandidateResult,
      expected: { ok: false, code: "dirty_work" },
    },
  ])(
    "returns the Candidate selection result for $name before validation",
    ({ captureResult, expected }) =>
      Effect.gen(function* () {
        const events: string[] = [];
        const submit = openChangeSubmit(
          dependencies({ events, change: readyChange(), captureResult }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Validation must not start"),
          validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listPhaseResults: () => Effect.succeed([]),
        });

        expect(
          yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
        ).toEqual(expected);
        expect(events).toEqual(["capture"]);
      }),
  );

  it.effect(
    "rejects a Repository Branch behind its fetched Change Base before Candidate creation",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const submit = openChangeSubmit(
          dependencies({
            events,
            change: readyChange({
              acceptanceContext: {
                version: 1,
                title: "Approved intent",
                description: "Deliver it",
              },
            }),
            refreshResult: { ok: true, base: refreshedBase },
            captureResult: {
              ok: false,
              code: "change_base_not_ancestor",
              branchRef: "refs/heads/change-1",
              headSha: "behind-head",
              changeBaseRef: "refs/remotes/origin/main",
              changeBaseSha: "base",
            },
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Validation must not start"),
          validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listPhaseResults: () => Effect.succeed([]),
        });

        expect(
          yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
        ).toEqual({
          ok: false,
          code: "change_base_not_ancestor",
          branchRef: "refs/heads/change-1",
          headSha: "behind-head",
          changeBaseRef: "refs/remotes/origin/main",
          changeBaseSha: "base",
        });
        expect(events).toEqual(["refresh_base", "capture"]);
      }),
  );

  it.effect("rejects a failed Change Base refresh before Candidate capture", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          refreshResult: {
            ok: false,
            code: "publication_remote_unreachable",
            remoteName: "origin",
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
      ).toEqual({
        ok: false,
        code: "publication_remote_unreachable",
        remoteName: "origin",
      });
      expect(events).toEqual(["refresh_base"]);
    }),
  );

  it.effect("rejects a missing GitHub target before Candidate validation starts", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          targetResult: { ok: false, code: "PR_TARGET_NOT_FOUND" },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start without a GitHub target"),
        validateAcceptanceContextCandidate: () =>
          Effect.die("Validation must not start without a GitHub target"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({ ok: false, code: "github_target_not_found" });
      expect(events).toEqual(["capture", "detect_target"]);
    }),
  );

  it.effect("returns Findings", () =>
    Effect.gen(function* () {
      const change = readyChange({
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
      });
      const submit = openChangeSubmit(dependencies({ change, findings: [finding] }));
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.succeed({
            ok: true,
            reused: false,
            validationRunId: 1,
            outcome: "blocked",
          }),
        listFindings: () => Effect.succeed([finding]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "validation_findings",
        changeId: change.id,
        candidateId: 1,
        validationRunId: 1,
        findings: [finding],
      });
    }),
  );

  it.effect("runs the enabled Stall Detection after a blocked Validation Run", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      let assessmentInput:
        | {
            readonly changeId: string;
            readonly validationRunId: number;
          }
        | undefined;
      const change = readyChange({
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
        policy: {
          reviewerConfiguration: {
            acceptanceReview: storedAcceptanceReviewer,
            specialistReviews: [],
          },
          stallDetection: {
            enabled: true,
            profile: storedAcceptanceReviewer.profile,
          },
          prepare: null,
          checks: changeWithoutTaskPolicy.checks,
        },
      });
      const stallDetection: StallDetectionService = {
        assess: (input) => {
          assessmentInput = input;
          return Effect.succeed({
            attempted: true as const,
            record: {
              id: 1,
              changeId: input.changeId,
              validationRunId: input.validationRunId,
              agentSessionId: 2,
              decision: "continue" as const,
              reason: "The trajectory is ambiguous.",
              configuration: input.configuration,
              input: {
                changeId: input.changeId,
                triggeringValidationRunId: input.validationRunId,
                acceptanceContext: {
                  version: 1,
                  title: "Approved intent",
                  description: "Deliver it",
                },
                qualifyingRuns: [],
                blockerHistory: { blockers: [], resolutions: [], active: null },
              },
              invocations: [],
              blockerId: null,
              createdAt: input.now,
            },
          });
        },
      };
      const submit = openChangeSubmit(dependencies({ events, change, stallDetection }));
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.succeed({
            ok: true,
            reused: false,
            validationRunId: 3,
            outcome: "blocked" as const,
          }),
        listFindings: () => Effect.succeed([finding]),
        listToolingFailures: () => Effect.succeed([]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({
        ok: false,
        code: "validation_findings",
        validationRunId: 3,
      });
      expect(assessmentInput).toMatchObject({ changeId: change.id, validationRunId: 3 });
    }),
  );

  it.effect("records a normal Stall Detection through Submit and SQLite persistence", () =>
    withTemporaryRepositoryState(({ repositoryRoot }) =>
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const acceptanceContext = {
          version: 1 as const,
          title: "Approved intent",
          description: "Deliver it",
        };
        const policy = readyChange({
          id: "BY-C1",
          acceptanceContext,
          policy: {
            reviewerConfiguration: {
              acceptanceReview: storedAcceptanceReviewer,
              specialistReviews: [],
            },
            stallDetection: { enabled: true, profile: storedAcceptanceReviewer.profile },
            prepare: null,
            checks: changeWithoutTaskPolicy.checks,
          },
        });
        const reviewerConfiguration = JSON.stringify(policy.policy.reviewerConfiguration);
        const ids = yield* repository.operation("create Stall Detection Submit fixture", (sql) =>
          Effect.gen(function* () {
            const change = yield* sql<{ readonly id: number }>`
              INSERT INTO changes (
                branch_ref, base_ref, base_remote_url, worktree_path,
                initial_acceptance_context, reviewer_configuration,
                stall_detection_definition, prepare_definition, checks_definition, cleanup_pending
              ) VALUES (
                'refs/heads/change-1', 'refs/remotes/origin/main', 'https://github.test/repo.git',
                '/repo/worktree', ${JSON.stringify(acceptanceContext)}, ${reviewerConfiguration},
                ${JSON.stringify({ enabled: true, profile: storedAcceptanceReviewer.profile })},
                NULL, ${JSON.stringify(changeWithoutTaskPolicy.checks)}, 0
              ) RETURNING id
            `;
            const changeId = change[0]?.id;
            if (changeId === undefined) return yield* Effect.dieMessage("Change was not created");
            const candidates: number[] = [];
            for (let index = 0; index < 3; index += 1) {
              const candidateRows = yield* sql<{ readonly id: number }>`
                INSERT INTO candidates (change_id, base_commit, head_commit)
                VALUES (${changeId}, 'base', ${`head-${index}`}) RETURNING id
              `;
              const candidateId = candidateRows[0]?.id;
              if (candidateId === undefined)
                return yield* Effect.dieMessage("Candidate was not created");
              candidates.push(candidateId);
            }
            const runs: number[] = [];
            for (const candidateId of candidates) {
              const runRows = yield* sql<{ readonly id: number }>`
                INSERT INTO validation_runs (
                  candidate_id, validation_input_snapshot, outcome, cleanup_pending
                ) VALUES (
                  ${candidateId}, ${JSON.stringify({ acceptanceContext })}, 'blocked', 0
                ) RETURNING id
              `;
              const runId = runRows[0]?.id;
              if (runId === undefined) return yield* Effect.dieMessage("Run was not created");
              runs.push(runId);
              yield* sql`
                INSERT INTO validation_phase_results (
                  validation_run_id, phase, producer, outcome, findings, artifacts
                ) VALUES (
                  ${runId}, 'acceptance_review', 'acceptance', 'failed',
                  ${JSON.stringify([
                    {
                      title: "Finding",
                      description: "The accepted outcome is not established.",
                      evidence: "Evidence",
                      files: [],
                      artifactRefs: [],
                    },
                  ])}, '[]'
                )
              `;
            }
            return { candidateId: candidates[2] as number, validationRunId: runs[2] as number };
          }),
        );
        const stallDetection = yield* openSqliteStallDetectionPersistence();
        const agentPersistence = yield* openSqliteAgentSessionPersistence();
        const piSmoke = runTestProcess(
          "sh",
          [
            "-c",
            `exec pi --extension ${JSON.stringify(join(process.cwd(), "test/fixtures/pi/deterministic-provider.mjs"))} -p --mode json --model but-why-test/deterministic-reviewer --no-session`,
          ],
          { cwd: repositoryRoot, env: { PI_OFFLINE: "1" }, input: "hello", timeout: 30_000 },
        );
        expect(piSmoke.status, piSmoke.stderr).toBe(0);
        const stallProvider = join(process.cwd(), "test/fixtures/pi/stall-detection-provider.mjs");
        const reviewerExecutor: ReviewerProcessExecutor = createPiReviewerProcessExecutor((input) =>
          Effect.sync(() => {
            const args = [
              "--extension",
              stallProvider,
              ...(input.args ?? [])
                .filter((argument) => argument !== "--no-extensions")
                .map((argument, index, all) =>
                  index > 0 && all[index - 1] === "--model"
                    ? "by-why-test/deterministic-stall-detector"
                    : argument,
                ),
            ];
            const process = runTestProcess(
              "sh",
              ["-c", `exec ${shellQuote(input.command)} ${args.map(shellQuote).join(" ")}`],
              {
                cwd: input.cwd ?? repositoryRoot,
                env: { PI_OFFLINE: "1" },
                ...(input.stdin === undefined ? {} : { input: input.stdin }),
                timeout: 30_000,
              },
            );
            if (process.error) throw process.error;
            return {
              exitCode: process.status ?? 1,
              stdout: process.stdout,
              stderr: process.stderr,
            };
          }),
        );
        const service = makeStallDetectionService({
          persistence: stallDetection,
          agentPersistence,
          runtime: piReviewerAgentRuntime as ReviewerAgentRuntime<StallDetectionAssessment>,
          reviewerExecutor,
          sessionStorageRoot: repositoryRoot,
        });
        const submit = openChangeSubmit(
          dependencies({
            change: policy,
            stallDetection: service,
            captureResult: {
              ...candidate,
              changeId: policy.id,
              candidateId: ids.candidateId,
            },
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
          validateAcceptanceContextCandidate: () =>
            Effect.succeed({
              ok: true,
              reused: false,
              validationRunId: ids.validationRunId,
              outcome: "blocked" as const,
            }),
          listFindings: () => Effect.succeed([finding]),
          listToolingFailures: () => Effect.succeed([]),
          listPhaseResults: () => Effect.succeed([]),
        });
        const result = yield* submit
          .submit({ changeId: policy.id, now })
          .pipe(Effect.provide(validationLayer));
        expect(result).toMatchObject({
          ok: false,
          code: "validation_findings",
          validationRunId: ids.validationRunId,
        });
        const record = yield* stallDetection.getByValidationRun(ids.validationRunId);
        expect(record).toMatchObject({
          changeId: policy.id,
          validationRunId: ids.validationRunId,
          decision: "continue",
          blockerId: null,
        });
        const invocationCount = yield* repository.operation(
          "inspect Stall Detection Submit fixture",
          (sql) =>
            sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count FROM stall_detection_agent_invocations
              WHERE validation_run_id = ${ids.validationRunId}
            `,
        );
        expect(invocationCount[0]?.count).toBe(1);
      }),
    ),
  );

  it.effect("returns Tooling Failures", () =>
    Effect.gen(function* () {
      const change = readyChange({
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          change,
          toolingFailures: [toolingFailure],
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Change without a Task validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.succeed({
            ok: false,
            validationRunId: 1,
            outcome: "tooling_failed",
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([toolingFailure]),
        listPhaseResults: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({
        ok: false,
        code: "validation_tooling_failed",
        validationRunId: 1,
        toolingFailures: [toolingFailure],
      });
    }),
  );
});

type PublicationFixture = {
  readonly publish: (input: PublishCandidateInput) => PublishCandidateResult;
  readonly associatePublishedChange?: () => { readonly ok: true } | { readonly ok: false };
};

type PullRequestObservation =
  | "exact_open"
  | "exact_closed_unmerged"
  | "exact_merged"
  | "unavailable";

const dependencies = (input: {
  readonly change: ChangeRecord;
  readonly events?: string[];
  readonly findings?: readonly (typeof finding)[];
  readonly toolingFailures?: readonly (typeof toolingFailure)[];
  readonly publication?: PublicationFixture;
  readonly pullRequestObservation?: PullRequestObservation;
  readonly pullRequestObservations?: readonly [PullRequestObservation, ...PullRequestObservation[]];
  readonly observedPullRequest?: GitHubPullRequest;
  readonly captureResult?: CaptureLocalCandidateResult;
  readonly captureResults?: readonly CaptureLocalCandidateResult[];
  readonly refreshResult?: RemoteChangeBaseResult;
  readonly branchHeadSha?: string;
  readonly publicationEvidence?: {
    readonly candidateId: number;
    readonly validationRunId: number;
    readonly changeBaseSha: string;
    readonly headSha: string;
  } | null;
  readonly executionLock?: ExecutionLock;
  readonly stallDetection?: StallDetectionService;
  readonly refreshResults?: readonly RemoteChangeBaseResult[];
  readonly completeMergedInputs?: Array<{ readonly changeId: string; readonly observed: unknown }>;
  readonly targetResult?:
    | { readonly ok: false; readonly code: "PR_TARGET_NOT_FOUND" }
    | {
        readonly ok: true;
        readonly target: {
          readonly owner: string;
          readonly repo: string;
          readonly baseBranch: string;
          readonly remoteName: string;
          readonly remoteUrl: string;
        };
      };
}) => {
  const events = input.events ?? [];
  const captureResults = [...(input.captureResults ?? [])];
  const refreshResults = [...(input.refreshResults ?? [])];
  const pullRequestObservations = [...(input.pullRequestObservations ?? [])];
  let currentTargetSha: string = refreshedBase.commit;
  return {
    repositoryPath: "/repo",
    persistence: {
      getChangeById: () => Effect.succeed(input.change),
      getChangeForOutputById: () => Effect.succeed(input.change),
      getCompletedPublicationEvidence: () =>
        Effect.sync(() => {
          events.push("read_publication_evidence");
          if (input.publicationEvidence === null) return undefined;
          return (
            input.publicationEvidence ?? {
              candidateId: input.change.publication?.candidateId ?? candidate.candidateId,
              validationRunId: input.change.publication?.validationRunId ?? 999,
              changeBaseSha: candidate.changeBaseSha,
              headSha: input.change.publication?.expectedHeadSha ?? candidate.headSha,
            }
          );
        }),
      completeMergedChange: (completeInput: {
        readonly changeId: string;
        readonly observed: unknown;
      }) =>
        Effect.sync(() => {
          input.completeMergedInputs?.push(completeInput);
          events.push("complete_merged_change");
          return { ok: true as const, changed: true, changeId: input.change.id };
        }),
    } satisfies ChangeSubmissionPort,
    github: pullRequestGateway(input, events, pullRequestObservations),
    publicationFor: () => {
      const publication =
        input.publication ??
        ({
          publish: () => {
            events.push("publish");
            return {
              ok: true,
              created: true,
              pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
            };
          },
        } satisfies PublicationFixture);
      return {
        publish: (publicationInput: PublishCandidateInput) =>
          Effect.sync(() => publication.publish(publicationInput)),
        associatePublishedChange: () =>
          Effect.sync(() => publication.associatePublishedChange?.() ?? { ok: true as const }),
      };
    },
    readBranchHead: () =>
      Effect.succeed({
        ok: true as const,
        headSha:
          input.branchHeadSha ?? input.change.publication?.expectedHeadSha ?? candidate.headSha,
      }),
    refreshBase: () => {
      if (input.refreshResult !== undefined || input.refreshResults !== undefined)
        events.push("refresh_base");
      const result = refreshResults.shift() ??
        input.refreshResult ?? { ok: true, base: refreshedBase };
      if (result.ok) currentTargetSha = result.base.commit;
      return result;
    },
    detectTarget: () => {
      events.push("detect_target");
      return (
        input.targetResult ?? {
          ok: true,
          target: {
            owner: "acme",
            repo: "repo",
            baseBranch: "main",
            remoteName: "origin",
            remoteUrl: "https://github.test/acme/repo.git",
          },
        }
      );
    },
    captureCandidate: (captureInput: CaptureLocalCandidateInput) =>
      Effect.sync(() => {
        expect(captureInput.changeBaseSha).toBe(currentTargetSha);
        events.push("capture");
        return captureResults.shift() ?? input.captureResult ?? candidate;
      }),
    executionLock: input.executionLock ?? { withLock: ({ effect }) => effect },
    ...(input.stallDetection === undefined ? {} : { stallDetection: input.stallDetection }),
  };
};

const pullRequestGateway = (
  input: {
    readonly change: ChangeRecord;
    readonly pullRequestObservation?: PullRequestObservation;
    readonly observedPullRequest?: GitHubPullRequest;
  },
  events: string[],
  observations: PullRequestObservation[],
): GitHubPullRequestReader => ({
  getPullRequest: () => {
    events.push("observe_pull_request");
    if (input.observedPullRequest !== undefined) {
      return { ok: true, pullRequest: input.observedPullRequest };
    }
    const publication = input.change.publication;
    if (publication === null || publication === undefined || publication.pullRequest === null) {
      return unavailablePullRequestRead;
    }
    const observation = observations.shift() ?? input.pullRequestObservation ?? "exact_open";
    if (observation === "unavailable") return unavailablePullRequestRead;
    const base = {
      number: publication.pullRequest.number,
      url: publication.pullRequest.url,
      repository: { owner: publication.target.owner, repo: publication.target.repo },
      baseBranch: publication.target.baseBranch,
      headBranch: publication.headBranch,
    };
    return {
      ok: true,
      pullRequest: {
        ...base,
        state: observation === "exact_open" ? ("open" as const) : ("closed" as const),
        merged: observation === "exact_merged",
        headSha: publication.expectedHeadSha,
      },
    };
  },
});

const unavailablePullRequestRead = {
  ok: false,
  evidence: { operation: "remote_lookup", classification: "unavailable" },
} as const;

const readyChange = (overrides: Partial<ChangeRecord> = {}): ChangeRecord => ({
  id: "change-1",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/change-1",
  baseRef: "refs/remotes/origin/main",
  baseRemoteUrl: "https://github.test/acme/repo.git",
  worktreePath: "/repo/worktree",
  acceptanceContext: null,
  policy: {
    reviewerConfiguration: {
      acceptanceReview: storedAcceptanceReviewer,
      specialistReviews: [],
    },
    stallDetection: { enabled: false, profile: null },
    prepare: null,
    checks: changeWithoutTaskPolicy.checks,
  },
  prepareFailure: null,
  implementationDecisions: [],
  activeBlocker: null,
  publication: null,
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
  cancelReason: null,
  ...overrides,
});

const refreshedBase = {
  remoteName: "origin",
  branchName: "main",
  remoteUrl: "https://github.test/acme/repo.git",
  ref: "refs/remotes/origin/main",
  commit: "base",
} as const;

const toolingFailure = {
  sequence: 1,
  validationRunId: 1,
  errorKind: "workspace_setup_failed",
  operationName: "create_workspace",
  errorMessage: "Workspace unavailable",
} as const;

const finding = {
  validationRunId: 1,
  phase: "checks",
  producer: "quality",
  title: "Quality failed",
  description: "Fix the quality check.",
  evidence: "quality exited with code 1",
  files: [],
  artifactRefs: [],
} as const;
