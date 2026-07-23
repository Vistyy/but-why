import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe } from "vitest";

import { CandidateValidation } from "../../src/change/candidateValidation/validateCandidate.js";
import type { ChangeRecord } from "../../src/change/change.js";
import type { ChangePersistence } from "../../src/change/changePersistence.js";
import type { ChangeReconciliation } from "../../src/change/reconcileChange.js";
import { openChangeSubmit } from "../../src/change/submitChange.js";
import type { CaptureLocalCandidateResult } from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type {
  PublishCandidateInput,
  PublishCandidateResult,
} from "../../src/change/publication/candidatePublication.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";

const now = "2026-06-30T12:00:00.000Z";
const candidate = {
  ok: true,
  changeId: "change-1",
  candidateId: "candidate-1",
  branchRef: "refs/heads/change-1",
  selectedBaseRef: "refs/heads/main",
  baseSource: "saved_change",
  resolvedTargetSha: "base",
  comparisonBaseSha: "base",
  headSha: "head",
} as const;
const tasklessPolicy = {
  sandboxMode: "none",
  checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
  copyFiles: [],
  specialistReviews: [],
} as const;

describe("Change Submit orchestration", () => {
  it.effect(
    "reconciles before Candidate selection and publishes one passing taskless Candidate",
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const submit = openChangeSubmit(
          dependencies({
            events,
            change: readyChange(),
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
          validateTaskBackedCandidate: () => Effect.die("Acceptance Review was not expected"),
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

  it.effect("runs Acceptance only and completes a Task-backed no-change submission", () =>
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
      const acceptanceReport = { findings: [] as readonly (typeof finding)[] };
      const submit = openChangeSubmit(
        dependencies({
          events,
          transitions,
          change,
          taskBacked: true,
          captureResult: { ...candidate, comparisonBaseSha: "base", headSha: "base" },
        }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Full validation was not expected"),
        validateTaskBackedCandidate: () => Effect.die("Full validation was not expected"),
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
            taskBacked: true,
            captureResult: { ...candidate, comparisonBaseSha: "base", headSha: "base" },
            findings: acceptanceReport.findings,
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Full validation was not expected"),
          validateTaskBackedCandidate: () => Effect.die("Full validation was not expected"),
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
        dependencies({ events, transitions, change, taskBacked: true }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateTaskBackedCandidate: (input) =>
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
            publication: {
              publish: () => {
                throw new Error("Duplicate publication");
              },
            },
          }),
        );
        const validationLayer = Layer.succeed(CandidateValidation, {
          validateCandidate: () => Effect.die("Duplicate validation"),
          validateTaskBackedCandidate: () => Effect.die("Duplicate validation"),
          listFindings: () => Effect.succeed([]),
          listToolingFailures: () => Effect.succeed([]),
          listRounds: () => Effect.succeed([]),
        });

        const result = yield* submit
          .submit({ changeId: change.id, now })
          .pipe(Effect.provide(validationLayer));

        expect(result).toMatchObject({ ok: true, status: "published", created: false });
        expect(events).toEqual(["reconcile", "capture"]);
      }),
  );

  it.effect.each([
    {
      name: "unchanged taskless work",
      captureResult: { ...candidate, headSha: "base" } as CaptureLocalCandidateResult,
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
          validateTaskBackedCandidate: () => Effect.die("Validation must not start"),
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
        validateTaskBackedCandidate: () =>
          Effect.die("Validation must not start without a GitHub target"),
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
        dependencies({ change, transitions, taskBacked: true, findings: [finding] }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateTaskBackedCandidate: () =>
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
        dependencies({ change, transitions, taskBacked: true, toolingFailures: [toolingFailure] }),
      );
      const validationLayer = Layer.succeed(CandidateValidation, {
        validateCandidate: () => Effect.die("Taskless validation was not expected"),
        validateTaskBackedCandidate: () =>
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
  readonly taskBacked?: boolean;
  readonly findings?: readonly (typeof finding)[];
  readonly toolingFailures?: readonly (typeof toolingFailure)[];
  readonly publication?: PublicationFixture;
  readonly reconciliationStatus?: "not_owned" | "open";
  readonly captureResult?: CaptureLocalCandidateResult;
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
  let taskState = "implementing";
  return {
    repositoryCommonDirectory: "/repo/.git",
    persistence: {
      getChangeById: () => Effect.succeed(input.change),
      completeNoChange: () => {
        events.push("complete_no_change");
        return Effect.succeed({ ok: true as const, changed: true });
      },
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
          return {
            rejected: false,
            changes: [
              {
                changeId: input.change.id,
                status: input.reconciliationStatus ?? "not_owned",
                ...(input.reconciliationStatus === "open" && input.change.publication?.pullRequest
                  ? { pullRequest: input.change.publication.pullRequest }
                  : {}),
              },
            ],
          };
        }),
    } satisfies ChangeReconciliation,
    resolvePolicy: () =>
      input.taskBacked
        ? ({
            ok: true,
            resolved: {
              taskBacked: true,
              policy: {
                ...tasklessPolicy,
                acceptanceReview: {
                  instructions: "Review intent",
                  instructionsSource: "built_in",
                  agentProfile: "default",
                  profileSource: "global",
                  profile: { agentRuntime: "pi", agentModel: "test/model" },
                },
              },
            },
          } as const)
        : ({ ok: true, resolved: { taskBacked: false, policy: tasklessPolicy } } as const),
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
    captureCandidate: () =>
      Effect.sync(() => {
        events.push("capture");
        return input.captureResult ?? candidate;
      }),
  };
};

const readyChange = (overrides: Partial<ChangeRecord> = {}): ChangeRecord => ({
  id: "change-1",
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/change-1",
  baseRef: "refs/heads/main",
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
