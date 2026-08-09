import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import type {
  ReviewerAgentInput,
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import { SandcastleToolingFailed } from "../../src/change/validation/validationToolingFailures.js";
import type { ExecutionLock } from "../../src/contracts/executionLock.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { openSqliteExecutionLock } from "../../src/sqlite/sqliteExecutionLock.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { openAbandonTaskReview } from "../../src/task/abandonTaskReview.js";
import {
  openTaskSubmission,
  type TaskSubmissionDependencies,
  type TaskSubmitResult,
} from "../../src/task/submitTask.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskReviewPersistence } from "../../src/task/taskReviewStore.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { git } from "../support/candidateReadyRepo.js";
import { withTestRepository } from "../support/repository.js";
import { runTestProcess } from "../support/testProcess.js";

const now = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

const reviewerConfig: RepoConfig = {
  taskPrefix: "BY",
  review: { task: { agentProfile: { name: "task-reviewer", scope: "repo" } } },
  agentProfiles: {
    "task-reviewer": { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
  },
};

const emptyGlobalConfig: GlobalConfig = {};

const taggedReviewerOutput = (value: unknown): string =>
  `<reviewer-output>${JSON.stringify(value)}</reviewer-output>`;

const passingReviewer = (reviewInputs: ReviewerAgentInput[]): ReviewerAgentRuntime => ({
  review: (input) =>
    Effect.sync((): ReviewerAgentResult => {
      reviewInputs.push(input);
      return {
        ok: true,
        report: { findings: [] },
        attempts: 1,
        stdout: taggedReviewerOutput({ findings: [] }),
        sessionReference: "session-pass",
      };
    }),
});

const failingReviewer = (failure: ReviewerAgentResult): ReviewerAgentRuntime => ({
  review: () => Effect.sync(() => failure),
});

const prepareInitializedTask = () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    expect(initialized.status).toBe(0);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(join(root, "task.md"), "Implement the requested change.");
    const created = yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Orchestrated proposal",
      "--file",
      "task.md",
    ]);
    expect(created.status).toBe(0);
    return root;
  });

const submissionDependencies = (
  root: string,
  input: {
    readonly events?: string[];
    readonly headReads?: { count: number };
    readonly readHead?: (
      cwd: string,
    ) => { readonly ok: true; readonly commit: string } | { readonly ok: false };
    readonly readRepoConfig?: (
      cwd: string,
      commit: string,
    ) =>
      | { readonly ok: true; readonly config: RepoConfig }
      | { readonly ok: false; readonly message: string };
    readonly readGlobalConfig?: (
      globalConfigPath: string,
    ) =>
      | { readonly ok: true; readonly config: GlobalConfig }
      | { readonly ok: false; readonly message: string };
    readonly readRepoInstructionsFileAtCommit?: (
      cwd: string,
      commit: string,
      instructionsFile: string,
    ) =>
      | { readonly ok: true; readonly instructions: string }
      | { readonly ok: false; readonly message: string };
    readonly reviewerSessionsRoot?: string;
    readonly reviewerAgentRuntime: ReviewerAgentRuntime;
    readonly executionLock?: ExecutionLock;
    readonly persistence: TaskReviewPersistence;
  },
): TaskSubmissionDependencies => ({
  persistence: input.persistence,
  executionLock:
    input.executionLock ?? openSqliteExecutionLock({ commonDirectory: join(root, ".git") }),
  mainCheckoutRoot: root,
  reviewerSessionsRoot: input.reviewerSessionsRoot ?? join(root, ".but-why"),
  globalConfigPath: join(root, ".test-global-config.json"),
  readMainCheckoutHead:
    input.readHead ??
    ((cwd) => {
      if (input.headReads !== undefined) input.headReads.count += 1;
      const commit = git(cwd, "rev-parse", "HEAD");
      return { ok: true as const, commit };
    }),
  readRepoConfigAtCommit:
    input.readRepoConfig ??
    ((() => ({
      ok: true as const,
      config: reviewerConfig,
    })) as TaskSubmissionDependencies["readRepoConfigAtCommit"]),
  readGlobalConfig:
    input.readGlobalConfig ??
    ((() => ({
      ok: true as const,
      config: emptyGlobalConfig,
    })) as TaskSubmissionDependencies["readGlobalConfig"]),
  ...(input.readRepoInstructionsFileAtCommit === undefined
    ? {}
    : { readRepoInstructionsFileAtCommit: input.readRepoInstructionsFileAtCommit }),
  reviewerAgentRuntime: input.reviewerAgentRuntime,
});

describe("Task Submission orchestration", () => {
  it.scoped(
    "passes a Task Review through the disposable workspace and moves the Task to Todo",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const tasks = yield* openSqliteTaskPersistence("BY");
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: passingReviewer(reviewInputs),
                persistence: reviews,
              }),
            );

            const result = yield* submission.submit({
              taskId: publicTaskId("BY-1"),
              now,
            });

            expect(result).toMatchObject({
              ok: true,
              status: "passed",
              baseCommit: git(root, "rev-parse", "HEAD"),
              task: { id: "BY-1", state: "todo" },
            });
            if (!result.ok || result.status === "tooling_failed") {
              throw new Error("unexpected result");
            }

            expect(reviewInputs).toHaveLength(1);
            expect(reviewInputs[0]?.reviewer).toBe("task_review");
            expect(reviewInputs[0]?.validationRunId).toBe(result.reviewId);
            expect(reviewInputs[0]?.availableArtifactRefs).toEqual([]);
            expect(reviewInputs[0]?.prompt).toContain("Orchestrated proposal");
            expect(reviewInputs[0]?.prompt).toContain(
              "You are the Task Reviewer for one unlinked New Task proposal.",
            );
            expect(reviewInputs[0]?.resumeSession).toBeUndefined();

            const recorded = yield* reviews.getReviewById(result.reviewId);
            expect(recorded).toMatchObject({
              id: result.reviewId,
              state: "complete",
              outcome: "passed",
              taskId: "BY-1",
            });
            const abandoned = yield* reviews.getAbandonmentContext(result.reviewId);
            expect(abandoned).toBeDefined();
            if (abandoned?.worktreePath !== undefined) {
              expect(existsSync(abandoned.worktreePath)).toBe(false);
            }
            const tempRef = runTestProcess(
              "git",
              [
                "rev-parse",
                "--verify",
                `refs/but-why/task-reviews/${result.reviewId}/review^{commit}`,
              ],
              { cwd: root },
            );
            expect(tempRef.status).not.toBe(0);
            const active = yield* reviews.getActiveForTask(publicTaskId("BY-1"));
            expect(active).toBeUndefined();
            expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({
              id: "BY-1",
              state: "todo",
            });
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "records Findings for a blocked Task Review and leaves the Task New",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const runtime: ReviewerAgentRuntime = {
              review: () =>
                Effect.sync(
                  (): ReviewerAgentResult => ({
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Missing acceptance criteria",
                          description:
                            "The Task Context has no behavior-based acceptance criteria.",
                          evidence: "command: none\nexitCode: 0",
                          files: [],
                          artifactRefs: [],
                        },
                      ],
                    },
                    attempts: 1,
                    stdout: taggedReviewerOutput({
                      findings: [
                        {
                          title: "Missing acceptance criteria",
                          description:
                            "The Task Context has no behavior-based acceptance criteria.",
                          evidence: "command: none\nexitCode: 0",
                          files: [],
                        },
                      ],
                    }),
                  }),
                ),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, { reviewerAgentRuntime: runtime, persistence: reviews }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

            expect(result).toMatchObject({
              ok: true,
              status: "blocked",
              task: { id: "BY-1", state: "new" },
            });
            if (!result.ok || result.status === "tooling_failed") {
              throw new Error("unexpected result");
            }
            expect(result.findings).toEqual([
              {
                id: `${result.reviewId}-task-review-F1`,
                reviewId: result.reviewId,
                title: "Missing acceptance criteria",
                description: "The Task Context has no behavior-based acceptance criteria.",
                evidence: "command: none\nexitCode: 0",
                files: [],
              },
            ]);
            const findings = yield* reviews.listFindings(result.reviewId);
            expect(findings).toHaveLength(1);
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "starts a fresh Review after a completed blocked Review",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            const headReads = { count: 0 };
            const blockedReviewer: ReviewerAgentRuntime = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult => {
                  reviewInputs.push(input);
                  return {
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                          artifactRefs: [],
                        },
                      ],
                    },
                    attempts: 1,
                    stdout: taggedReviewerOutput({
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                        },
                      ],
                    }),
                  };
                }),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: blockedReviewer,
                headReads,
                persistence: reviews,
              }),
            );

            const first = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(first).toMatchObject({ ok: true, status: "blocked" });
            expect(headReads.count).toBe(1);

            const second = yield* submission.submit({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            expect(second).toMatchObject({ ok: true, status: "blocked" });
            expect(headReads.count).toBe(2);
            expect(reviewInputs).toHaveLength(2);
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "starts a new Review with prior evidence for a changed proposal",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const tasks = yield* openSqliteTaskPersistence("BY");
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            const blockedReviewer: ReviewerAgentRuntime = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult => {
                  reviewInputs.push(input);
                  return {
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                          artifactRefs: [],
                        },
                      ],
                    },
                    attempts: 1,
                    stdout: taggedReviewerOutput({
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                        },
                      ],
                    }),
                  };
                }),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: blockedReviewer,
                persistence: reviews,
              }),
            );

            const first = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(first).toMatchObject({ ok: true, status: "blocked" });
            const firstReviewId = (first as Extract<TaskSubmitResult, { readonly ok: true }>)
              .reviewId;

            const prerequisite = yield* tasks.createTask({
              title: "Prerequisite",
              description: "Prerequisite description",
              now: secondNow,
            });
            if (!prerequisite.ok) throw new Error(prerequisite.code);
            const edited = yield* tasks.editTaskDependencies({
              taskId: publicTaskId("BY-1"),
              operation: "replace",
              prerequisiteTaskIds: [publicTaskId(prerequisite.task.id)],
            });
            if (!edited.ok) throw new Error(edited.code);

            const second = yield* submission.submit({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            expect(second).toMatchObject({ ok: true, status: "blocked" });
            const secondReviewId = (second as Extract<TaskSubmitResult, { readonly ok: true }>)
              .reviewId;
            expect(secondReviewId).not.toBe(firstReviewId);

            const secondInput = reviewInputs[1];
            expect(secondInput?.prompt).toContain(
              "Deterministic proposal diff from the prior reviewed proposal:",
            );
            expect(secondInput?.prompt).toContain("Prior applicable Task Review outcome:");
            expect(secondInput?.prompt).toContain(firstReviewId);
            expect(secondInput?.prompt).toContain("Prerequisite");
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "uses an earlier applicable outcome when a newer Review is Tooling Failure",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            let calls = 0;
            const reviewer: ReviewerAgentRuntime = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult => {
                  reviewInputs.push(input);
                  calls += 1;
                  if (calls === 2) {
                    return {
                      ok: false,
                      failure: new SandcastleToolingFailed({
                        operationName: "run_reviewer_agent",
                        message: "reviewer process failed",
                      }),
                      sessionUsability: "unknown",
                      attempts: 1,
                      stdout: "",
                    };
                  }
                  return {
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                          artifactRefs: [],
                        },
                      ],
                    },
                    attempts: 1,
                    stdout: taggedReviewerOutput({
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                        },
                      ],
                    }),
                  };
                }),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: reviewer,
                persistence: reviews,
              }),
            );

            // First Review is blocked on the original proposal.
            const first = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(first).toMatchObject({ ok: true, status: "blocked" });
            const firstReviewId = (first as Extract<TaskSubmitResult, { readonly ok: true }>)
              .reviewId;

            // Change the proposal, then a Tooling Failure on the changed proposal
            // becomes the newest completed Review.
            const tasks = yield* openSqliteTaskPersistence("BY");
            const edited = yield* tasks.updateTaskContext({
              taskId: publicTaskId("BY-1"),
              title: "Changed proposal",
              description: "Changed description",
              now: secondNow,
            });
            expect(edited.ok).toBe(true);
            if (!edited.ok) throw new Error(edited.code);

            const tooled = yield* submission.submit({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            expect(tooled).toMatchObject({ ok: true, status: "tooling_failed" });

            // Submit the changed proposal again: the earlier blocked outcome is
            // the applicable prior even though a newer Tooling Failure exists.
            const third = yield* submission.submit({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            expect(third).toMatchObject({ ok: true, status: "blocked" });
            const priorInput = reviewInputs[reviewInputs.length - 1];
            expect(priorInput?.prompt).toContain("Prior applicable Task Review outcome:");
            expect(priorInput?.prompt).toContain(firstReviewId);
            expect(priorInput?.prompt).toContain(
              "Deterministic proposal diff from the prior reviewed proposal:",
            );
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "reads repository Task Reviewer instructions at the exact HEAD commit",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            const readCalls: Array<{ cwd: string; commit: string; path: string }> = [];
            const repoConfig: RepoConfig = {
              taskPrefix: "BY",
              review: {
                task: {
                  agentProfile: { name: "task-reviewer", scope: "repo" },
                  instructionsFile: "docs/task-review.md",
                },
              },
              agentProfiles: {
                "task-reviewer": {
                  agentRuntime: "pi",
                  runtimeConfig: { model: "test-model" },
                },
              },
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: passingReviewer(reviewInputs),
                persistence: reviews,
                readRepoConfig: () => ({ ok: true as const, config: repoConfig }),
                readRepoInstructionsFileAtCommit: (cwd, commit, path) => {
                  readCalls.push({ cwd, commit, path });
                  return {
                    ok: true as const,
                    instructions: `Committed instructions at ${commit}`,
                  };
                },
              }),
            );

            const head = git(root, "rev-parse", "HEAD");
            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(result).toMatchObject({ ok: true, status: "passed" });
            const passed = result as Extract<TaskSubmitResult, { readonly ok: true }>;
            expect(readCalls).toEqual([{ cwd: root, commit: head, path: "docs/task-review.md" }]);
            const prompt = reviewInputs[0]?.prompt ?? "";
            expect(prompt).toContain(`Committed instructions at ${head}`);
            expect(prompt).not.toContain("dirty checkout instructions");

            // The immutable policy snapshot records the committed instructions.
            const recorded = yield* reviews.getReviewById(passed.reviewId);
            expect(recorded?.policy.instructions).toBe(`Committed instructions at ${head}`);
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "records context-file discovery in the immutable policy and session identity",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            const repoConfig: RepoConfig = {
              taskPrefix: "BY",
              review: { task: { agentProfile: { name: "task-reviewer", scope: "repo" } } },
              agentProfiles: {
                "task-reviewer": {
                  agentRuntime: "pi",
                  runtimeConfig: {
                    model: "test-model",
                    contextFileDiscovery: false,
                  },
                },
              },
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: passingReviewer(reviewInputs),
                persistence: reviews,
                readRepoConfig: () => ({ ok: true as const, config: repoConfig }),
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(result).toMatchObject({ ok: true, status: "passed" });
            const passed = result as Extract<TaskSubmitResult, { readonly ok: true }>;

            const recorded = yield* reviews.getReviewById(passed.reviewId);
            expect(recorded?.policy.profile.runtimeConfig?.contextFileDiscovery).toBe(false);
            const session = yield* reviews.getTaskReviewSession(
              publicTaskId("BY-1"),
              "task_review",
            );
            expect(session?.fingerprint).toBeDefined();
            expect(session?.fingerprint.length).toBeGreaterThan(0);
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "records a Tooling Failure and leaves the Task New",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const failure: ReviewerAgentResult = {
              ok: false,
              failure: new SandcastleToolingFailed({
                operationName: "run_reviewer_agent",
                message: "reviewer process failed",
              }),
              sessionUsability: "unknown",
              attempts: 1,
              stdout: "",
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: failingReviewer(failure),
                persistence: reviews,
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

            expect(result).toMatchObject({
              ok: true,
              status: "tooling_failed",
              task: { id: "BY-1", state: "new" },
            });
            if (!result.ok || result.status !== "tooling_failed") {
              throw new Error("unexpected result");
            }
            expect(result.toolingFailures).toEqual([
              expect.objectContaining({
                errorKind: "infrastructure_tooling_failed",
                operationName: "run_task_reviewer_agent",
                errorMessage: "reviewer process failed",
              }),
            ]);
            const recorded = yield* reviews.getReviewById(result.reviewId);
            expect(recorded).toMatchObject({ state: "complete", outcome: "tooling_failed" });
            expect(yield* reviews.listToolingFailures(result.reviewId)).toHaveLength(1);

            // The final cleanup result is persisted even on the tooling-failure
            // path, so recovery carries the exact cleanup outcome.
            const setup = yield* reviews.getAbandonmentContext(result.reviewId);
            expect(setup?.cleanupWorktree).toBe("removed");
            expect(setup?.cleanupTempRef).toBe("removed");
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "records a Tooling Failure when Reviewer Session permissions cannot be hardened",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const runtime: ReviewerAgentRuntime = {
              review: () =>
                Effect.sync(
                  (): ReviewerAgentResult => ({
                    ok: true,
                    report: { findings: [] },
                    attempts: 1,
                    stdout: taggedReviewerOutput({ findings: [] }),
                    sessionReference: "session-hardening",
                    sessionFilePath: join(root, "no-such-session-file"),
                  }),
                ),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: runtime,
                persistence: reviews,
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

            expect(result).toMatchObject({
              ok: true,
              status: "tooling_failed",
              task: { id: "BY-1", state: "new" },
            });
            if (!result.ok || result.status !== "tooling_failed") {
              throw new Error("unexpected result");
            }
            expect(result.toolingFailures).toEqual([
              expect.objectContaining({
                errorKind: "reviewer_session_hardening_failed",
                operationName: "harden_reviewer_session_permissions",
              }),
            ]);
            const recorded = yield* reviews.getReviewById(result.reviewId);
            expect(recorded).toMatchObject({ state: "complete", outcome: "tooling_failed" });
            const session = yield* reviews.getTaskReviewSession(
              publicTaskId("BY-1"),
              "task_review",
            );
            expect(session).toBeUndefined();
          }),
        );
      }),
    60_000,
  );

  it.scoped("reports an unavailable main checkout before any workspace work", () =>
    Effect.gen(function* () {
      const root = yield* prepareInitializedTask();
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const reviews = yield* openSqliteTaskReviewPersistence();
          const reviewInputs: ReviewerAgentInput[] = [];
          const submission = openTaskSubmission(
            submissionDependencies(root, {
              reviewerAgentRuntime: passingReviewer(reviewInputs),
              readHead: () => ({ ok: false }),
              persistence: reviews,
            }),
          );

          const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

          expect(result).toEqual({ ok: false, code: "main_checkout_unavailable" });
          expect(reviewInputs).toHaveLength(0);
        }),
      );
    }),
  );

  it.scoped("reports an invalid Task Reviewer policy before any workspace work", () =>
    Effect.gen(function* () {
      const root = yield* prepareInitializedTask();
      yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const reviews = yield* openSqliteTaskReviewPersistence();
          const reviewInputs: ReviewerAgentInput[] = [];
          const submission = openTaskSubmission(
            submissionDependencies(root, {
              reviewerAgentRuntime: passingReviewer(reviewInputs),
              readRepoConfig: () => ({
                ok: false,
                message: "Repo Config is invalid: review.task.agentProfile is missing.",
              }),
              persistence: reviews,
            }),
          );

          const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

          expect(result).toMatchObject({
            ok: false,
            code: "validation_policy_invalid",
          });
          expect(reviewInputs).toHaveLength(0);
        }),
      );
    }),
  );

  it.scoped(
    "continues a compatible Reviewer Session on a later Review",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const tasks = yield* openSqliteTaskPersistence("BY");
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            const blockedReviewer: ReviewerAgentRuntime = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult => {
                  reviewInputs.push(input);
                  return {
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                          artifactRefs: [],
                        },
                      ],
                    },
                    attempts: 1,
                    stdout: taggedReviewerOutput({
                      findings: [
                        {
                          title: "Needs evidence",
                          description: "Provide repository evidence.",
                          evidence: "command: none",
                          files: [],
                        },
                      ],
                    }),
                    sessionReference: "session-A",
                  };
                }),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: blockedReviewer,
                persistence: reviews,
              }),
            );

            const first = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(first).toMatchObject({ ok: true, status: "blocked" });
            expect(reviewInputs[0]?.resumeSession).toBeUndefined();

            const prerequisite = yield* tasks.createTask({
              title: "Prerequisite",
              description: "Prerequisite description",
              now: secondNow,
            });
            if (!prerequisite.ok) throw new Error(prerequisite.code);
            const edited = yield* tasks.editTaskDependencies({
              taskId: publicTaskId("BY-1"),
              operation: "replace",
              prerequisiteTaskIds: [publicTaskId(prerequisite.task.id)],
            });
            if (!edited.ok) throw new Error(edited.code);

            const second = yield* submission.submit({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            expect(second).toMatchObject({ ok: true, status: "blocked" });
            expect(reviewInputs).toHaveLength(2);
            expect(reviewInputs[1]?.resumeSession).toBe("session-A");
            expect(reviewInputs[1]?.prompt).toContain(
              "Continue the Task Reviewer Session for the exact Task Review.",
            );

            const session = yield* reviews.getTaskReviewSession(
              publicTaskId("BY-1"),
              "task_review",
            );
            expect(session?.sessionReference).toBe("session-A");
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "leaves a Review active when transcript indexing fails",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput[] = [];
            // A session file with an unidentified Pi Session makes transcript indexing fail.
            mkdirSync(join(root, ".but-why", "BY-1", "task_review", "reviewer-sessions"), {
              recursive: true,
            });
            writeFileSync(
              join(root, ".but-why", "BY-1", "task_review", "reviewer-sessions", "bad.jsonl"),
              "not a session",
            );
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: passingReviewer(reviewInputs),
                persistence: reviews,
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

            expect(result).toMatchObject({
              ok: false,
              code: "review_cleanup_pending",
              completionFailure: { operationName: "index_task_review_transcripts" },
            });
            if (result.ok || result.code !== "review_cleanup_pending") {
              throw new Error("unexpected result");
            }
            expect(yield* reviews.getActiveForTask(publicTaskId("BY-1"))).toMatchObject({
              reviewId: result.reviewId,
            });
            const recorded = yield* reviews.getReviewById(result.reviewId);
            expect(recorded).toMatchObject({ state: "running" });
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "resolves the exact feature-branch HEAD, excludes dirty content, and isolates the canonical checkout",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        git(root, "checkout", "-b", "feature");
        git(root, "commit", "--allow-empty", "-m", "feature work");
        writeFileSync(join(root, "uncommitted.txt"), "not in any commit");
        const featureHead = git(root, "rev-parse", "HEAD");

        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            let workspacePath: string | undefined;
            const runtime: ReviewerAgentRuntime = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult => {
                  workspacePath = input.commandCwd;
                  const workspaceHead = runTestProcess("git", ["rev-parse", "HEAD"], {
                    cwd: input.commandCwd ?? root,
                  });
                  const dirtyContentPresent =
                    input.commandCwd === undefined
                      ? false
                      : existsSync(join(input.commandCwd, "uncommitted.txt"));
                  return {
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Workspace evidence",
                          description: JSON.stringify({
                            headMatches:
                              workspaceHead.status === 0 &&
                              workspaceHead.stdout.trim() === featureHead,
                            dirtyContentPresent,
                          }),
                          evidence: "command: git rev-parse HEAD",
                          files: [],
                          artifactRefs: [],
                        },
                      ],
                    },
                    attempts: 1,
                    stdout: taggedReviewerOutput({
                      findings: [
                        {
                          title: "Workspace evidence",
                          description: JSON.stringify({
                            headMatches:
                              workspaceHead.status === 0 &&
                              workspaceHead.stdout.trim() === featureHead,
                            dirtyContentPresent,
                          }),
                          evidence: "command: git rev-parse HEAD",
                          files: [],
                        },
                      ],
                    }),
                  };
                }),
            };
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: runtime,
                persistence: reviews,
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });
            expect(result).toMatchObject({ ok: true, status: "blocked" });
            if (!result.ok || result.status === "tooling_failed") {
              throw new Error("unexpected result");
            }
            const evidence = JSON.parse(result.findings?.[0]?.description ?? "{}") as {
              readonly headMatches: boolean;
              readonly dirtyContentPresent: boolean;
            };
            expect(evidence.headMatches).toBe(true);
            expect(evidence.dirtyContentPresent).toBe(false);
            expect(workspacePath).toBeDefined();
            expect(workspacePath).not.toBe(root);

            // The canonical checkout remains untouched on the feature branch.
            expect(git(root, "rev-parse", "HEAD")).toBe(featureHead);
            expect(existsSync(join(root, "uncommitted.txt"))).toBe(true);

            const recorded = yield* reviews.getReviewById(result.reviewId);
            expect(recorded?.baseCommit).toBe(featureHead);

            // The final cleanup result is persisted after scoped cleanup, so the
            // Review carries accurate recovery evidence instead of the provisional
            // not_created admission record.
            const setup = yield* reviews.getAbandonmentContext(result.reviewId);
            expect(setup?.submittedSha).toBe(featureHead);
            expect(setup?.cleanupWorktree).toBe("removed");
            expect(setup?.cleanupTempRef).toBe("removed");
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "abandons a Review left active by a stopped Submission process",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        const head = git(root, "rev-parse", "HEAD");
        const tempRefName = "refs/but-why/task-reviews/review-abandon/review";
        const worktreePath = join(
          root,
          ".sandcastle",
          "worktrees",
          tempRefName.replaceAll("/", "-"),
        );
        git(root, "update-ref", "--no-deref", tempRefName, head);
        git(root, "worktree", "add", "--detach", worktreePath, tempRefName);
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const started = yield* reviews.startOrReuse({
              taskId: publicTaskId("BY-1"),
              baseCommit: head,
              policy: {
                version: 1,
                instructions: "Review",
                instructionsSource: "built_in",
                profile: { agentProfile: "task-reviewer", scope: "repo" },
              },
              reviewId: "review-abandon",
              now,
            });
            expect(started).toMatchObject({ ok: true, reused: false });
            yield* reviews.recordWorkspaceSetup({
              reviewId: "review-abandon",
              tempRefName,
              submittedSha: head,
              worktreeHead: head,
              worktreePath,
              cleanupWorktree: "not_created",
              cleanupTempRef: "not_created",
              createdAt: now,
            });

            const abandon = openAbandonTaskReview({
              persistence: reviews,
              executionLock: openSqliteExecutionLock({ commonDirectory: join(root, ".git") }),
              repoRoot: root,
              reviewerSessionsRoot: join(root, ".git", "but-why"),
            });

            const result = yield* abandon.abandon({
              reviewId: "review-abandon",
              reason: "Submission process stopped",
              now,
            });
            expect(result).toEqual({ ok: true, status: "abandoned", taskId: "BY-1" });

            expect(existsSync(worktreePath)).toBe(false);
            const tempRef = runTestProcess(
              "git",
              ["rev-parse", "--verify", `${tempRefName}^{commit}`],
              { cwd: root },
            );
            expect(tempRef.status).not.toBe(0);
            expect(yield* reviews.getActiveForTask(publicTaskId("BY-1"))).toBeUndefined();
            const recorded = yield* reviews.getReviewById("review-abandon");
            expect(recorded).toMatchObject({
              state: "complete",
              outcome: "tooling_failed",
            });
          }),
        );
      }),
    60_000,
  );
});
