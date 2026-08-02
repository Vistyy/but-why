import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe } from "vitest";

import { CandidateValidation } from "../../src/change/candidateValidation/validateCandidate.js";
import type { CandidateValidationPolicyResolution } from "../../src/change/candidateValidation/resolveCandidateValidationPolicy.js";
import type { ChangeRecord } from "../../src/change/change.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import type { ChangePersistence } from "../../src/change/changePersistence.js";
import type { ChangeReconciliation } from "../../src/change/reconcileChange.js";
import { openChangeSubmit } from "../../src/change/submitChange.js";
import type {
  CaptureLocalCandidateInput,
  CaptureLocalCandidateResult,
} from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type {
  PublishCandidateInput,
  PublishCandidateResult,
} from "../../src/change/publication/candidatePublication.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { RemoteChangeBaseResult } from "../../src/submissionEnvironment/remoteChangeBase.js";
import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { ExecutionLockUnavailable, type ExecutionLock } from "../../src/contracts/executionLock.js";
import { RepoConfigValidationFailed } from "../../src/contracts/configErrors.js";

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
  it.effect("reports the exact Active Validation Run before Candidate capture", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          validationPersistence: {
            getActiveForChange: () =>
              Effect.succeed({ validationRunId: "run-active", changeId: "change-1" }),
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        validateNoChange: () => Effect.die("Validation must not start"),
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
      expect(events).toEqual(["reconcile"]);
    }),
  );

  it.effect("rejects a concurrent Submit before it reads Change state", () =>
    Effect.gen(function* () {
      const lock: ExecutionLock = {
        withLock: () =>
          Effect.fail(
            new ExecutionLockUnavailable({
              owner: "change_submission",
              key: "change-1",
              lockPath: "/tmp/change-1.sqlite",
              cause: new Error("busy"),
            }),
          ),
      };
      const submit = openChangeSubmit(
        dependencies({ events: [], change: readyChange(), executionLock: lock }),
      );
      const result = yield* submit.submit({ changeId: "change-1", now }).pipe(
        Effect.provide(
          Layer.succeed(CandidateValidation, {
            validateCandidate: () => Effect.die("Validation must not start"),
            validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
            validateNoChange: () => Effect.die("Validation must not start"),
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
    }),
  );

  it.effect(
    "reconciles before Candidate selection and publishes one passing taskless Candidate",
    () =>
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
          validateAcceptanceContextCandidate: () =>
            Effect.die("Acceptance Review was not expected"),
          validateNoChange: () => Effect.die("Acceptance-only validation was not expected"),
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
        expect(events).toEqual([
          "reconcile",
          "capture",
          "detect_target",
          "validate_taskless",
          "publish",
        ]);
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
                        agentProfile: "candidate-reviewer",
                        profileScope: "repo",
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
                  agentProfile: "candidate-reviewer",
                  profileScope: "repo",
                  profile: { profile: { runtimeConfig: { model: "candidate/model" } } },
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
          validateNoChange: () => Effect.die("Acceptance-only validation was not expected"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listRounds: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: "change-1", now })
          .pipe(Effect.provide(validationLayer));

        expect(result).toMatchObject({ ok: true, status: "published" });
        expect(events).toEqual([
          "reconcile",
          "refresh_base",
          "load_base_repo_config",
          "capture",
          "load_candidate_repo_config",
          "resolve_policy",
          "detect_target",
          "validate_taskless",
          "publish",
        ]);
      }),
  );

  it.effect("rejects invalid Change Base Repo Config before Candidate capture", () =>
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
        validateNoChange: () => Effect.die("Validation must not start"),
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
      expect(events).toEqual(["reconcile"]);
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
        validateNoChange: () => Effect.die("Acceptance-only validation was not expected"),
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
        "reconcile",
        "refresh_base",
        "capture",
        "detect_target",
        "validate_taskless",
        "publish",
        "reconcile",
        "refresh_base",
        "capture",
        "detect_target",
        "validate_taskless",
        "publish",
      ]);
    }),
  );

  it.effect("runs Acceptance only and completes a Task-backed no-change submission", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const transitions: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        startingCommit: null,
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
          comments: [],
        },
      });
      const acceptanceReport = { findings: [] as readonly (typeof finding)[] };
      const submit = openChangeSubmit(
        dependencies({
          events,
          transitions,
          change,
          acceptanceContextSupplied: true,
          captureResult: {
            ...candidate,
            changeBaseSha: "base",
            headSha: "base",
            trackedTreeMatchesChangeBase: true,
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Full validation was not expected"),
        validateAcceptanceContextCandidate: () => Effect.die("Full validation was not expected"),
        validateNoChange: (input) =>
          Effect.sync(() => {
            events.push("validate_no_change");
            expect(input.acceptanceContext.title).toBe("Approved intent");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-no-change",
              outcome: acceptanceReport.findings.length === 0 ? "passed" : "blocked",
            } as const;
          }),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: true,
        status: "no_change",
        changeId: change.id,
        candidateId: "candidate-1",
        validationRunId: "run-no-change",
        completionKind: "no_change",
      });
      expect(events).toEqual(["reconcile", "capture", "validate_no_change", "complete_no_change"]);
      expect(transitions).toEqual(["validating"]);
    }),
  );

  it.effect(
    "returns no-change Acceptance Findings and moves the linked Task back to implementing",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const transitions: string[] = [];
        const change = readyChange({
          taskId: publicTaskId("BY-1"),
          acceptanceContext: {
            version: 1,
            title: "Approved intent",
            description: "Deliver it",
            comments: [],
          },
        });
        const acceptanceReport = { findings: [finding] as readonly (typeof finding)[] };
        const submit = openChangeSubmit(
          dependencies({
            events,
            transitions,
            change,
            acceptanceContextSupplied: true,
            captureResult: {
              ...candidate,
              changeBaseSha: "base",
              headSha: "base",
              trackedTreeMatchesChangeBase: true,
            },
            findings: acceptanceReport.findings,
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Full validation was not expected"),
          validateAcceptanceContextCandidate: () => Effect.die("Full validation was not expected"),
          validateNoChange: () =>
            Effect.succeed({
              ok: true,
              reused: false,
              validationRunId: "run-no-change",
              outcome: acceptanceReport.findings.length === 0 ? "passed" : "blocked",
            } as const),
          listFindings: () => Effect.succeed(acceptanceReport.findings),
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
          validationRunId: "run-no-change",
          findings: [finding],
        });
        expect(events).toEqual(["reconcile", "capture"]);
        expect(transitions).toEqual(["validating", "implementing"]);
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
          comments: [],
        },
        implementationDecisions: [
          {
            id: "decision-1",
            changeId: "change-1",
            sequence: 1,
            recordedAt: now,
            content: "Keep the same owned pull request.",
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
          reconciliationStatus: "open",
          branchHeadSha: "base",
          captureResult: {
            ...candidate,
            changeBaseSha: "base",
            headSha: "base",
            trackedTreeMatchesChangeBase: true,
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateNoChange: () => Effect.die("No-Change validation was not expected"),
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
        implementationDecisions: change.implementationDecisions,
      });
      expect(events).toEqual([
        "reconcile",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish",
      ]);
    }),
  );

  it.effect("completes a changed-then-reverted Task-backed Change through Acceptance", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const transitions: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
          comments: [],
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          transitions,
          change,
          acceptanceContextSupplied: true,
          captureResults: [
            { ...candidate, headSha: "changed-head" },
            { ...candidate, headSha: "base", trackedTreeMatchesChangeBase: true },
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
              validationRunId: "run-changed",
              outcome: "blocked",
            } as const;
          }),
        validateNoChange: () =>
          Effect.sync(() => {
            events.push("validate_no_change");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-no-change",
              outcome: "passed",
            } as const;
          }),
        listFindings: () => Effect.succeed([finding]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const first = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      const second = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(first).toMatchObject({ ok: false, code: "validation_findings" });
      expect(second).toMatchObject({ ok: true, status: "no_change" });
      expect(events).toEqual([
        "reconcile",
        "capture",
        "detect_target",
        "validate_task_backed",
        "reconcile",
        "capture",
        "validate_no_change",
        "complete_no_change",
      ]);
      expect(transitions).toEqual(["validating", "implementing", "validating"]);
    }),
  );

  it.effect("returns a durable no-change completion on repeated Submit", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        state: "closed",
        closeReason: "completed",
        closedAt: now,
        noChangeCompletion: {
          candidateId: "candidate-no-change",
          validationRunId: "run-no-change",
          changeBaseSha: "base",
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          refreshResult: { ok: true, base: refreshedBase },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation was not expected"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation was not expected"),
        validateNoChange: () => Effect.die("Validation was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({
        ok: true,
        status: "no_change",
        changeId: change.id,
        candidateId: "candidate-no-change",
        validationRunId: "run-no-change",
        completionKind: "no_change",
      });
      expect(events).toEqual([]);
    }),
  );

  it.effect("keeps completed no-change evidence stable when the Change Base advances", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        state: "closed",
        closeReason: "completed",
        closedAt: now,
        noChangeCompletion: {
          candidateId: "candidate-no-change",
          validationRunId: "run-no-change",
          changeBaseSha: "base",
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          refreshResult: {
            ok: true,
            base: { ...refreshedBase, commit: "advanced-base" },
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation was not expected"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation was not expected"),
        validateNoChange: () => Effect.die("Validation was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toEqual({
        ok: true,
        status: "no_change",
        changeId: change.id,
        candidateId: "candidate-no-change",
        validationRunId: "run-no-change",
        completionKind: "no_change",
      });
      expect(events).toEqual([]);
    }),
  );

  it.effect("uses Acceptance Context for a Task-backed Candidate and marks the Task ready", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const transitions: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
          comments: [],
        },
      });
      const submit = openChangeSubmit(
        dependencies({ events, transitions, change, acceptanceContextSupplied: true }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateAcceptanceContextCandidate: (input) =>
          Effect.sync(() => {
            events.push("validate_task_backed");
            expect(input.acceptanceContext.title).toBe("Approved intent");
            return {
              ok: true,
              reused: false,
              validationRunId: "run-1",
              outcome: "passed",
            } as const;
          }),
        validateNoChange: () => Effect.die("Taskless validation was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(result.ok).toBe(true);
      expect(events).toEqual([
        "reconcile",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish",
      ]);
      expect(transitions).toEqual(["validating", "ready"]);
    }),
  );

  it.effect("continues to validated publication after a stale stored Candidate is observed", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange({
        publication: {
          candidateId: "previous-candidate",
          validationRunId: "previous-run",
          target: { owner: "acme", repo: "repo", baseBranch: "main", remoteName: "origin" },
          headBranch: "change-1",
          expectedHeadSha: "previous-head",
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          reconciliationStatus: "rejected",
          reconciliationRejection: "head_sha_mismatch",
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
        validateNoChange: () => Effect.die("Acceptance-only validation was not expected"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({ ok: true, status: "published", candidateId: "candidate-1" });
      expect(events).toEqual([
        "reconcile",
        "capture",
        "detect_target",
        "validate_taskless",
        "publish",
      ]);
    }),
  );

  it.effect.each([
    {
      status: "completed" as const,
      expected: { ok: true, status: "reconciled" },
    },
    {
      status: "closed_unmerged" as const,
      expected: { ok: false, code: "owned_pull_request_closed" },
    },
  ])(
    "returns authoritative $status pull request facts before fetching the Change Base",
    ({ status, expected }) =>
      Effect.gen(function* () {
        const events: string[] = [];
        const submit = openChangeSubmit(
          dependencies({ events, change: readyChange(), reconciliationStatus: status }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Validation must not start"),
          validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
          validateNoChange: () => Effect.die("Validation must not start"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listRounds: () => Effect.succeed([]),
        });

        expect(
          yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
        ).toMatchObject(expected);
        expect(events).toEqual(["reconcile"]);
      }),
  );

  it.effect("reopens a closed owned pull request before revising the same publication", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const publicationResults: PublishCandidateResult[] = [
        { ok: false, code: "publication_remote_mismatch" },
        {
          ok: true,
          created: false,
          pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
        },
      ];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
          comments: [],
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
          reconciliationStatuses: ["closed_unmerged", "open", "open"],
          publication: {
            publish: () => {
              events.push("publish");
              return (
                publicationResults.shift() ?? { ok: false, code: "publication_tooling_failed" }
              );
            },
          },
          acceptanceContextSupplied: true,
          branchHeadSha: "base",
          captureResults: [
            { ...candidate, trackedTreeMatchesChangeBase: true },
            { ...candidate, candidateId: "candidate-2", headSha: "revised-head" },
          ],
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateNoChange: () => Effect.die("No-Change validation was not expected"),
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

      const closed = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      const rejected = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));
      const published = yield* submit
        .submit({ changeId: change.id, now })
        .pipe(Effect.provide(validationLayer));

      expect(closed).toEqual({ ok: false, code: "owned_pull_request_closed", changeId: change.id });
      expect(rejected).toEqual({ ok: false, code: "publication_remote_mismatch" });
      expect(published).toMatchObject({
        ok: true,
        status: "published",
        created: false,
        pullRequest: { number: 42 },
      });
      expect(events).toEqual([
        "reconcile",
        "reconcile",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish",
        "reconcile",
        "capture",
        "detect_target",
        "validate_task_backed",
        "publish",
      ]);
    }),
  );

  it.effect("keeps rejecting reconciliation mismatches other than the Candidate commit", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const change = readyChange();
      const submit = openChangeSubmit(
        dependencies({
          events,
          change,
          reconciliationStatus: "rejected",
          reconciliationRejection: "base_branch_mismatch",
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        validateNoChange: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: change.id, now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({
        ok: false,
        code: "reconciliation_rejected",
        change: { rejection: "base_branch_mismatch" },
      });
      expect(events).toEqual(["reconcile"]);
    }),
  );

  it.effect(
    "returns an existing owned pull request without duplicate validation or publication",
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
            reconciliationStatus: "open",
            agentEnvironmentError: "Managed Worktree Repo Config is invalid.",
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
          validateNoChange: () => Effect.die("Duplicate validation"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listRounds: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: change.id, now })
          .pipe(Effect.provide(validationLayer));

        expect(result).toMatchObject({ ok: true, status: "published", created: false });
        expect(events).toEqual(["reconcile", "read_publication_evidence"]);
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
          reconciliationStatus: "open",
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
        validateNoChange: () => Effect.die("No-Change validation was not expected"),
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
        "reconcile",
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
          validateNoChange: () => Effect.die("Validation must not start"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listRounds: () => Effect.succeed([]),
        });

        expect(
          yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
        ).toEqual(expected);
        expect(events).toEqual(["reconcile", "capture"]);
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
                comments: [],
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
          validateNoChange: () => Effect.die("Validation must not start"),
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
        expect(events).toEqual(["reconcile", "refresh_base", "capture"]);
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
        validateNoChange: () => Effect.die("Validation must not start"),
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
      expect(events).toEqual(["reconcile", "refresh_base"]);
    }),
  );

  it.effect("rejects a changed publication remote before Candidate capture", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const submit = openChangeSubmit(
        dependencies({
          events,
          change: readyChange(),
          refreshResult: {
            ok: false,
            code: "publication_remote_changed",
            remoteName: "origin",
            expectedRemoteUrl: "https://github.test/acme/repo.git",
            actualRemoteUrl: "https://github.test/acme/other.git",
          },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Validation must not start"),
        validateAcceptanceContextCandidate: () => Effect.die("Validation must not start"),
        validateNoChange: () => Effect.die("Validation must not start"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      expect(
        yield* submit.submit({ changeId: "change-1", now }).pipe(Effect.provide(validationLayer)),
      ).toMatchObject({ ok: false, code: "publication_remote_changed", remoteName: "origin" });
      expect(events).toEqual(["reconcile", "refresh_base"]);
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
        validateNoChange: () => Effect.die("Validation must not start without a GitHub target"),
        listFindings: () => Effect.succeed([]),
        listToolingFailures: () => Effect.succeed([]),
        listRounds: () => Effect.succeed([]),
      });

      const result = yield* submit
        .submit({ changeId: "change-1", now })
        .pipe(Effect.provide(validationLayer));

      expect(result).toEqual({ ok: false, code: "github_target_not_found" });
      expect(events).toEqual(["reconcile", "capture", "detect_target"]);
    }),
  );

  it.effect("returns Findings and moves a linked Task back to implementing", () =>
    Effect.gen(function* () {
      const transitions: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
          comments: [],
        },
      });
      const submit = openChangeSubmit(
        dependencies({ change, transitions, acceptanceContextSupplied: true, findings: [finding] }),
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
        validateNoChange: () => Effect.die("Taskless validation was not expected"),
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
      expect(transitions).toEqual(["validating", "implementing"]);
    }),
  );

  it.effect("returns Tooling Failures and moves a linked Task back to implementing", () =>
    Effect.gen(function* () {
      const transitions: string[] = [];
      const change = readyChange({
        taskId: publicTaskId("BY-1"),
        acceptanceContext: {
          version: 1,
          title: "Approved intent",
          description: "Deliver it",
          comments: [],
        },
      });
      const submit = openChangeSubmit(
        dependencies({
          change,
          transitions,
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
        validateNoChange: () => Effect.die("Taskless validation was not expected"),
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
      expect(transitions).toEqual(["validating", "implementing"]);
    }),
  );
});

type PublicationFixture = {
  readonly publish: (input: PublishCandidateInput) => PublishCandidateResult;
};

const dependencies = (input: {
  readonly change: ChangeRecord;
  readonly events?: string[];
  readonly transitions?: string[];
  readonly acceptanceContextSupplied?: boolean;
  readonly agentEnvironment?: readonly string[];
  readonly agentEnvironmentError?: string;
  readonly baselineRepoConfigError?: string;
  readonly candidateRepoConfigError?: string;
  readonly trackPolicyResolution?: boolean;
  readonly candidateRepoConfig?: RepoConfig;
  readonly baselineRepoConfig?: RepoConfig;
  readonly resolvePolicy?: (
    acceptanceContextSupplied: boolean,
    repoConfig: RepoConfig,
    worktreePath: string,
    validationRepoConfig?: RepoConfig,
  ) => CandidateValidationPolicyResolution;
  readonly findings?: readonly (typeof finding)[];
  readonly toolingFailures?: readonly (typeof toolingFailure)[];
  readonly publication?: PublicationFixture;
  readonly reconciliationStatus?:
    | "not_owned"
    | "open"
    | "rejected"
    | "completed"
    | "closed_unmerged";
  readonly reconciliationStatuses?: readonly [
    "not_owned" | "open" | "rejected" | "completed" | "closed_unmerged",
    ...("not_owned" | "open" | "rejected" | "completed" | "closed_unmerged")[],
  ];
  readonly reconciliationRejection?: string;
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
  readonly validationPersistence?: Pick<ChangeValidationPersistence, "getActiveForChange">;
  readonly executionLock?: ExecutionLock;
  readonly refreshResults?: readonly RemoteChangeBaseResult[];
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
  const reconciliationStatuses = [...(input.reconciliationStatuses ?? [])];
  let currentTargetSha: string = refreshedBase.commit;
  let taskState = "implementing";
  return {
    repositoryCommonDirectory: "/repo/.git",
    repositoryPath: "/repo",
    persistence: {
      getChangeById: () => Effect.succeed(input.change),
      getPassingPublicationEvidence: () =>
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
      completeNoChange: () => {
        events.push("complete_no_change");
        return Effect.succeed({ ok: true as const, changed: true });
      },
      transitionLinkedTask: ({ to }: { readonly to: string }) =>
        Effect.sync(() => {
          input.transitions?.push(to);
          taskState = to;
          return true;
        }),
    } as unknown as ChangePersistence,
    taskPersistence: {
      getTaskById: () => Effect.succeed({ state: taskState }),
      transitionTaskState: ({ to }: { readonly to: string }) =>
        Effect.sync(() => {
          input.transitions?.push(to);
          taskState = to;
          return { ok: true, changed: true, task: {} };
        }),
    } as unknown as TaskPersistence,
    reconciliation: {
      reconcile: () =>
        Effect.sync(() => {
          events.push("reconcile");
          const status =
            reconciliationStatuses.shift() ?? input.reconciliationStatus ?? "not_owned";
          return {
            rejected: status === "rejected",
            changes: [
              {
                changeId: input.change.id,
                status,
                ...(status === "open" && input.change.publication?.pullRequest
                  ? { pullRequest: input.change.publication.pullRequest }
                  : {}),
                ...(status === "rejected"
                  ? { rejection: input.reconciliationRejection ?? "remote_mismatch" }
                  : {}),
              },
            ],
          };
        }),
    } satisfies ChangeReconciliation,
    loadRepoConfig: () => {
      if (input.trackPolicyResolution) events.push("load_candidate_repo_config");
      const error = input.candidateRepoConfigError ?? input.agentEnvironmentError;
      return error === undefined
        ? { ok: true as const, config: input.candidateRepoConfig ?? { taskPrefix: "BY" } }
        : { ok: false as const, message: error };
    },
    loadRepoConfigAtCommit: () => {
      if (input.trackPolicyResolution) events.push("load_base_repo_config");
      const error = input.baselineRepoConfigError ?? input.agentEnvironmentError;
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
      if (input.agentEnvironmentError !== undefined) {
        return {
          ok: false as const,
          error: new RepoConfigValidationFailed({
            diagnostics: [],
            message: input.agentEnvironmentError,
          }),
        };
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
                  agentProfile: "default",
                  profileScope: "global",
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
    ...(input.validationPersistence === undefined
      ? {}
      : { validationPersistence: input.validationPersistence }),
    ...(input.executionLock === undefined ? {} : { executionLock: input.executionLock }),
  };
};

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
  readiness: "ready",
  prepare: null,
  prepareFailure: null,
  publication: null,
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
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
