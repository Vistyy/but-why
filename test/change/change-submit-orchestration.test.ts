import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe } from "vitest";
import { MissingAgentProfile } from "../../src/agent/agentProfileErrors.js";
import type {
  CaptureLocalCandidateInput,
  CaptureLocalCandidateResult,
} from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type { CandidateValidationPolicyResolution } from "../../src/change/candidateValidation/resolveCandidateValidationPolicy.js";
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
import type { SubmitRejectionError } from "../../src/change/submit/submitRejectionErrors.js";
import { openChangeSubmit } from "../../src/change/submitChange.js";
import { GlobalConfigValidationFailed } from "../../src/contracts/configErrors.js";
import { type ExecutionLock, ExecutionLockUnavailable } from "../../src/contracts/executionLock.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import type { RemoteChangeBaseResult } from "../../src/submissionEnvironment/adapters/remoteChangeBase.js";
import { publicTaskId } from "../../src/task/taskId.js";

const now = "2026-06-30T12:00:00.000Z";
const candidate = {
  ok: true,
  changeId: "change-1",
  candidateId: "candidate-1",
  branchRef: "refs/heads/change-1",
  changeBaseSha: "base",
  headSha: "head",
  trackedTreeMatchesChangeBase: false,
} as const;
const tasklessPolicy = {
  checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
  copyFiles: [],
  specialistReviews: [],
} as const;

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
            validationRunId: "run-active",
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "active_validation_run",
        changeId: "change-1",
        validationRunId: "run-active",
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
            listRounds: () => Effect.succeed([]),
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

  it.effect("uses the Agent Environment to validate and publish a passing taskless Candidate", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          agentEnvironment: ["nix", "develop", "-c"],
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
            events.push("validate_taskless");
            expect(input.policy.agentEnvironment).toEqual(["nix", "develop", "-c"]);
            return {
              ok: true,
              reused: false,
              validationRunId: "run-1",
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: true,
        status: "published",
        changeId: "change-1",
        candidateId: "candidate-1",
        validationRunId: "run-1",
        created: true,
        pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
      });
      expect(events).toEqual(["capture", "detect_target", "validate_taskless", "publish"]);
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
            events.push("validate_taskless");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-1",
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({ ok: true, status: "published" });
      expect(events).toEqual(["capture", "detect_target", "validate_taskless", "publish"]);
      expect(change.prepareFailure).toMatchObject({ exitCode: 7 });
    }),
  );

  it.effect("retries a pending publication for a newer Candidate through Submit", () =>
    Effect.gen(function* () {
      const publishedCandidates: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          change: readyChange({
            publication: {
              candidateId: "candidate-0",
              validationRunId: "run-0",
              target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
              headBranch: "change-1",
              expectedHeadSha: "old-head",
              pullRequest: null,
            },
          }),
          captureResults: [
            candidate,
            { ...candidate, candidateId: "candidate-2", headSha: "head-2" },
          ],
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
              validationRunId: `run-${validationRuns}`,
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
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
      expect(publishedCandidates).toEqual(["candidate-1", "candidate-2"]);
    }),
  );

  it.effect(
    "loads the policy baseline before Candidate capture and reviewer config after capture",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const submit = openChangeSubmit(
          dependencies({
            events,
            change: readyChange(),
            trackPolicyResolution: true,
            candidateRepoConfig: { taskPrefix: "BY", review: { specialists: ["candidate"] } },
            baselineRepoConfig: { taskPrefix: "BY", review: { specialists: ["baseline"] } },
            refreshResult: { ok: true, base: refreshedBase },
            resolvePolicy: (
              _acceptanceContextSupplied,
              repoConfig,
              _worktreePath,
              validationRepoConfig,
            ) => {
              expect(repoConfig.review?.specialists).toEqual(["candidate"]);
              expect(validationRepoConfig?.review?.specialists).toEqual(["baseline"]);
              return {
                ok: true,
                resolved: {
                  acceptanceContextSupplied: false,
                  policy: {
                    ...tasklessPolicy,
                    specialistReviews: [
                      {
                        id: "candidate",
                        instructions: "Candidate reviewer",
                        instructionsSource: "repo",
                        profile: {
                          agentProfile: "candidate-reviewer",
                          scope: "repo",
                          profile: {
                            agentRuntime: "pi",
                            runtimeConfig: { model: "candidate/model" },
                          },
                        },
                      },
                    ],
                  },
                },
              } satisfies CandidateValidationPolicyResolution;
            },
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: (input) =>
            Effect.sync(() => {
              events.push("validate_taskless");
              expect(input.policy.specialistReviews).toMatchObject([
                {
                  id: "candidate",
                  profile: {
                    agentProfile: "candidate-reviewer",
                    scope: "repo",
                    profile: { runtimeConfig: { model: "candidate/model" } },
                  },
                },
              ]);
              return {
                ok: true,
                reused: false,
                validationRunId: "run-1",
                outcome: "passed",
              } as const;
            }),
          validateAcceptanceContextCandidate: () =>
            Effect.die("Acceptance Review was not expected"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listRounds: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: "change-1", now })
          .pipe(Effect.provide(validationLayer));

        expect(result).toMatchObject({ ok: true, status: "published" });
        expect(events).toEqual([
          "refresh_base",
          "capture",
          "load_base_repo_config",
          "load_candidate_repo_config",
          "resolve_policy",
          "detect_target",
          "validate_taskless",
          "publish",
        ]);
      }),
  );

  it.effect("rejects invalid Change Base Repo Config after Candidate capture", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          baselineRepoConfigError: "Change Base Repo Config is invalid.",
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "validation_policy_invalid",
        message: "Change Base Repo Config is invalid.",
      });
      expect(events).toEqual(["capture"]);
    }),
  );

  it.effect("rejects a missing reviewer Agent Profile before Validation starts", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          policyRejection: new MissingAgentProfile({
            profileName: "missing-reviewer",
            scope: "repo",
            selection: "explicit",
          }),
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "validation_policy_invalid",
        message: 'Agent Profile "missing-reviewer" in repo scope was not found.',
      });
      expect(events).toEqual(["capture"]);
    }),
  );

  it.effect("propagates malformed Global Config path and diagnostics without Git", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          policyRejection: new GlobalConfigValidationFailed({
            path: "/repo/global-config.json",
            diagnostics: [
              {
                path: ["agentProfiles", "implementation", "agentModel"],
                expected: "a Pi runtimeConfig model",
                actual: undefined,
                message: "Required value is missing.",
              },
            ],
            message: "Global Config is invalid.",
          }),
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "validation_policy_invalid",
        message: "Global Config is invalid.",
        details: {
          path: "/repo/global-config.json",
          diagnostics: [
            {
              path: ["agentProfiles", "implementation", "agentModel"],
              expected: "a Pi runtimeConfig model",
              actual: undefined,
              message: "Required value is missing.",
            },
          ],
        },
      });
      expect(events).toEqual(["capture"]);
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
              candidateId: "candidate-old-target",
              changeBaseSha: oldTargetSha,
              headSha,
            },
            {
              ...candidate,
              candidateId: "candidate-new-target",
              changeBaseSha: newTargetSha,
              headSha,
            },
          ],
        }),
      );
      const validatedCandidates: string[] = [];
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: (input) =>
          Effect.sync(() => {
            events.push("validate_taskless");
            validatedCandidates.push(input.candidateId);
            return {
              ok: true,
              reused: false,
              validationRunId:
                input.candidateId === "candidate-old-target" ? "run-old-target" : "run-new-target",
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const oldTarget = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));
      const newTarget = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(oldTarget).toMatchObject({
        ok: true,
        candidateId: "candidate-old-target",
        validationRunId: "run-old-target",
      });
      expect(newTarget).toMatchObject({
        ok: true,
        candidateId: "candidate-new-target",
        validationRunId: "run-new-target",
      });
      expect(validatedCandidates).toEqual(["candidate-old-target", "candidate-new-target"]);
      expect(events).toEqual([
        "refresh_base",
        "capture",
        "detect_target",
        "validate_taskless",
        "publish",
        "refresh_base",
        "capture",
        "detect_target",
        "validate_taskless",
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
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
        implementationDecisions: [
          {
            id: "decision-1",
            changeId: "change-1",
            sequence: 1,
            recordedAt: now,
            choice: "Keep the same owned pull request",
            rationale: "Preserve the existing owned pull request.",
          },
        ],
        publication: {
          candidateId: "published-candidate",
          validationRunId: "published-run",
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
          acceptanceContextSupplied: true,
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
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateAcceptanceContextCandidate: (input) =>
          Effect.sync(() => {
            seenValidationInput = input;
            events.push("validate_task_backed");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-1",
              outcome: "passed",
            } as const;
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({ ok: true, status: "published", pullRequest: { number: 42 } });
      expect(seenPublishInput).toMatchObject({
        candidateId: "candidate-1",
        validationRunId: "run-1",
      });
      expect(seenValidationInput).toMatchObject({
        changeId: change.id,
        candidateId: "candidate-1",
      });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish",
      ]);
    }),
  );

  it.effect("selects authority-backed validation for a Task-backed Candidate", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
      });
      const submit = openChangeSubmit(
        dependencies({ events, change, acceptanceContextSupplied: true }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateAcceptanceContextCandidate: (input) =>
          Effect.sync(() => {
            events.push("validate_task_backed");
            expect(input.changeId).toBe(change.id);
            return {
              ok: true,
              reused: false,
              validationRunId: "run-1",
              outcome: "passed",
            } as const;
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result.ok).toBe(true);
      expect(events).toEqual(["capture", "detect_target", "validate_task_backed", "publish"]);
    }),
  );

  it.effect("completes an exact merged owned pull request through terminal completion", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const completeMergedInputs: Array<{ readonly changeId: string; readonly observed: unknown }> =
        [];
      const change = readyChange({
        publication: {
          candidateId: "published-candidate",
          validationRunId: "published-run",
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
        listRounds: () => Effect.succeed([]),
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
            candidateId: "published-candidate",
            validationRunId: "published-run",
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
          candidateId: "published-candidate",
          validationRunId: "published-run",
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
            events.push("validate_taskless");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-1",
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({ ok: true, status: "published", created: false });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_taskless",
        "publish",
      ]);
    }),
  );

  it.effect("reopens a closed owned pull request before revising the same publication", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
        publication: {
          candidateId: "published-candidate",
          validationRunId: "published-run",
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
          acceptanceContextSupplied: true,
          branchHeadSha: "base",
          captureResults: [
            { ...candidate, trackedTreeMatchesChangeBase: false },
            {
              ...candidate,
              candidateId: "candidate-2",
              headSha: "revised-head",
              trackedTreeMatchesChangeBase: false,
            },
          ],
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.sync(() => {
            events.push("validate_task_backed");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-revised",
              outcome: "passed",
            } as const;
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
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
        candidateId: "published-candidate",
        expectedHeadSha: "published-head",
      });
      expect(events).toEqual([
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish:candidate-1",
        "observe_pull_request",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish:candidate-2",
      ]);
    }),
  );

  it.effect("rejects mismatched owned pull request identity facts before Candidate work", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: "published-candidate",
          validationRunId: "published-run",
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
        listRounds: () => Effect.succeed([]),
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
          candidateId: "published-candidate",
          validationRunId: "published-run",
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
        listRounds: () => Effect.succeed([]),
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

  it.effect(
    "returns completed publication before fetching the Change Base or resolving configuration",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const change = readyChange({
          publication: {
            candidateId: "candidate-1",
            validationRunId: "run-1",
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
            trackPolicyResolution: true,
            refreshResult: {
              ok: false,
              code: "publication_remote_unreachable",
              remoteName: "origin",
            },
            baselineRepoConfigError: "Later Change Base Repo Config is invalid.",
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
          listRounds: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: change.id, now })
          .pipe(Effect.provide(validationLayer));

        expect(result).toMatchObject({ ok: true, status: "published", created: false });
        expect(events).toEqual(["observe_pull_request", "read_publication_evidence"]);
      }),
  );

  it.effect("does not reuse publication when only the Repository Branch head matches", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: "other-candidate",
          validationRunId: "other-run",
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
            events.push("validate_taskless");
            return {
              ok: true,
              reused: false,
              validationRunId: "new-run",
              outcome: "passed",
            } as const;
          }),
        validateAcceptanceContextCandidate: () => Effect.die("Acceptance Review was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({
        ok: true,
        status: "published",
        candidateId: "candidate-1",
        validationRunId: "new-run",
      });
      expect(events).toEqual([
        "observe_pull_request",
        "read_publication_evidence",
        "capture",
        "detect_target",
        "validate_taskless",
        "publish",
      ]);
    }),
  );

  it.effect.each([
    {
      name: "unchanged taskless work",
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
          listRounds: () => Effect.succeed([]),
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
              taskId: publicTaskId("BY-1"),
              acceptanceContext: {
                version: 1,
                title: "Approved intent",
                description: "Deliver it",
              },
            }),
            acceptanceContextSupplied: true,
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
          listRounds: () => Effect.succeed([]),
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
        listRounds: () => Effect.succeed([]),
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
        listRounds: () => Effect.succeed([]),
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
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
      });
      const submit = openChangeSubmit(
        dependencies({ change, acceptanceContextSupplied: true, findings: [finding] }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.succeed({
            ok: true,
            reused: false,
            validationRunId: "run-1",
            outcome: "blocked",
          }),
        listFindings: () => Effect.succeed([finding]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: false,
        code: "validation_findings",
        changeId: change.id,
        candidateId: "candidate-1",
        validationRunId: "run-1",
        findings: [finding],
      });
    }),
  );

  it.effect("returns Tooling Failures", () =>
    Effect.gen(function* () {
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          change,
          acceptanceContextSupplied: true,
          toolingFailures: [toolingFailure],
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateAcceptanceContextCandidate: () =>
          Effect.succeed({
            ok: false,
            validationRunId: "run-1",
            outcome: "tooling_failed",
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([toolingFailure]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toMatchObject({
        ok: false,
        code: "validation_tooling_failed",
        validationRunId: "run-1",
        toolingFailures: [toolingFailure],
      });
    }),
  );
});

type PublicationFixture = {
  readonly publish: (input: PublishCandidateInput) => PublishCandidateResult;
};

type PullRequestObservation =
  | "exact_open"
  | "exact_closed_unmerged"
  | "exact_merged"
  | "unavailable";

const dependencies = (input: {
  readonly change: ChangeRecord;
  readonly events?: string[];
  readonly acceptanceContextSupplied?: boolean;
  readonly agentEnvironment?: readonly string[];
  readonly baselineRepoConfigError?: string;
  readonly trackPolicyResolution?: boolean;
  readonly candidateRepoConfig?: RepoConfig;
  readonly baselineRepoConfig?: RepoConfig;
  readonly resolvePolicy?: (
    acceptanceContextSupplied: boolean,
    repoConfig: RepoConfig,
    worktreePath: string,
    validationRepoConfig?: RepoConfig,
  ) => CandidateValidationPolicyResolution;
  readonly policyRejection?: SubmitRejectionError | GlobalConfigValidationFailed;
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
    readonly candidateId: string;
    readonly validationRunId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  } | null;
  readonly executionLock?: ExecutionLock;
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
    repositoryCommonDirectory: "/repo/.git",
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
              validationRunId:
                input.change.publication?.validationRunId ?? "published-validation-run",
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
    loadRepoConfig: () => {
      if (input.trackPolicyResolution) events.push("load_candidate_repo_config");
      return { ok: true as const, config: input.candidateRepoConfig ?? { taskPrefix: "BY" } };
    },
    loadRepoConfigAtCommit: () => {
      if (input.trackPolicyResolution) events.push("load_base_repo_config");
      const error = input.baselineRepoConfigError;
      return error === undefined
        ? { ok: true as const, config: input.baselineRepoConfig ?? { taskPrefix: "BY" } }
        : { ok: false as const, message: error };
    },
    resolvePolicy: (
      acceptanceContextSupplied: boolean,
      repoConfig: RepoConfig,
      worktreePath: string,
      validationRepoConfig?: RepoConfig,
    ) => {
      if (input.trackPolicyResolution) events.push("resolve_policy");
      if (input.resolvePolicy !== undefined) {
        return input.resolvePolicy(
          acceptanceContextSupplied,
          repoConfig,
          worktreePath,
          validationRepoConfig,
        );
      }
      if (input.policyRejection !== undefined) {
        return { ok: false as const, error: input.policyRejection };
      }
      return input.acceptanceContextSupplied
        ? ({
            ok: true,
            resolved: {
              acceptanceContextSupplied: true,
              policy: {
                ...tasklessPolicy,
                acceptanceReview: {
                  instructions: "Review intent",
                  instructionsSource: "built_in",
                  profile: {
                    agentProfile: "default",
                    scope: "global",
                    profile: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
                  },
                },
              },
            },
          } as const)
        : ({
            ok: true,
            resolved: {
              acceptanceContextSupplied: false,
              policy: {
                ...tasklessPolicy,
                ...(input.agentEnvironment === undefined
                  ? {}
                  : { agentEnvironment: input.agentEnvironment }),
              },
            },
          } as const);
    },
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
  taskId: null,
  startingCommit: "base",
  worktreePath: "/repo/worktree",
  acceptanceContext: null,
  prepare: null,
  prepareFailure: null,
  implementationDecisions: [],
  activeBlocker: null,
  publication: null,
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
  cancelReason: null,
  createdAt: now,
  updatedAt: now,
  closedAt: null,
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
  validationRunId: "run-1",
  errorKind: "workspace_setup_failed",
  operationName: "create_workspace",
  errorMessage: "Workspace unavailable",
  createdAt: now,
} as const;

const finding = {
  id: "finding-1",
  validationRunId: "run-1",
  phase: "checks",
  producer: "quality",
  title: "Quality failed",
  description: "Fix the quality check.",
  evidence: "quality exited with code 1",
  files: [],
  artifactRefs: [],
  createdAt: now,
  updatedAt: now,
} as const;
