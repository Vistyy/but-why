import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Sandbox } from "@ai-hero/sandcastle";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import type {
  ReviewerAgentInput,
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import {
  piReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ExecutionLock } from "../../src/contracts/executionLock.js";
import type { GlobalConfig } from "../../src/contracts/globalConfig.js";
import type { RepoConfig } from "../../src/contracts/repoConfig.js";
import { openSqliteExecutionLock } from "../../src/sqlite/sqliteExecutionLock.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { openAbandonTaskReview } from "../../src/task/abandonTaskReview.js";
import { openTaskSubmission, type TaskSubmissionDependencies } from "../../src/task/submitTask.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  decodeTaskReviewRuntimeOutput,
  type TaskReviewReviewerOutput,
} from "../../src/task/taskReviewPolicy.js";
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

const reviewerConfig: RepoConfig = { taskPrefix: "BY" };

const emptyGlobalConfig: GlobalConfig = {
  defaultAgentProfile: { name: "task-reviewer", scope: "global" },
  agentProfiles: {
    "task-reviewer": { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
  },
};

const taggedReviewerOutput = (value: unknown): string =>
  `<reviewer-output>${JSON.stringify(value)}</reviewer-output>`;

const passingReviewer = (
  reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[],
): ReviewerAgentRuntime<TaskReviewReviewerOutput> => ({
  review: (input) =>
    Effect.sync((): ReviewerAgentResult<TaskReviewReviewerOutput> => {
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

const failingReviewer = (
  failure: ReviewerAgentResult<TaskReviewReviewerOutput>,
): ReviewerAgentRuntime<TaskReviewReviewerOutput> => ({
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
    readonly reviewerAgentRuntime: ReviewerAgentRuntime<TaskReviewReviewerOutput>;
    readonly createWorkspace?: TaskSubmissionDependencies["createWorkspace"];
    readonly executionLock?: ExecutionLock;
    readonly persistence: TaskReviewPersistence;
  },
): TaskSubmissionDependencies => ({
  persistence: input.persistence,
  executionLock:
    input.executionLock ?? openSqliteExecutionLock({ commonDirectory: join(root, ".git") }),
  mainCheckoutRoot: root,
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
  ...(input.createWorkspace === undefined ? {} : { createWorkspace: input.createWorkspace }),
});

describe("Task Submission orchestration", () => {
  it.scoped(
    "passes a Task Review through the disposable workspace and leaves the Task New",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const tasks = yield* openSqliteTaskPersistence("BY");
            const reviews = yield* openSqliteTaskReviewPersistence();
            const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
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
              task: { id: "BY-1", state: "new" },
            });
            if (!result.ok || result.status === "tooling_failed") {
              throw new Error("unexpected result");
            }

            expect(reviewInputs).toHaveLength(1);
            expect(reviewInputs[0]?.reviewer).toBe("task_review");
            expect(reviewInputs[0]?.prompt).toContain("Orchestrated proposal");
            expect(reviewInputs[0]?.prompt).toContain(
              "You are the Task Reviewer for one unlinked New Task proposal.",
            );
            expect(reviewInputs[0]?.resumeSession).toBeUndefined();

            const recorded = yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1"));
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
              state: "new",
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
            const runtime: ReviewerAgentRuntime<TaskReviewReviewerOutput> = {
              review: () =>
                Effect.sync(
                  (): ReviewerAgentResult<TaskReviewReviewerOutput> => ({
                    ok: true,
                    report: {
                      findings: [
                        {
                          title: "Missing acceptance criteria",
                          description:
                            "The Task Context has no behavior-based acceptance criteria.",
                          evidence: "command: none\nexitCode: 0",
                          files: [],
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
            const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
            const headReads = { count: 0 };
            const blockedReviewer: ReviewerAgentRuntime<TaskReviewReviewerOutput> = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult<TaskReviewReviewerOutput> => {
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
    "records a Tooling Failure and leaves the Task New",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const failure: ReviewerAgentResult<TaskReviewReviewerOutput> = {
              ok: false,
              failure: new ReviewerExecutionFailed({
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
                operationName: "run_reviewer_agent",
                errorMessage: "reviewer process failed",
              }),
            ]);
            const recorded = yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1"));
            expect(recorded).toMatchObject({ state: "complete", outcome: "tooling_failed" });
            expect(yield* reviews.listToolingFailures(result.reviewId)).toHaveLength(1);

            // The final cleanup result is persisted even on the tooling-failure
            // path, so recovery carries the exact cleanup outcome.
            const setup = yield* reviews.getAbandonmentContext(result.reviewId);
            expect(setup?.cleanupWorktree).toBe("removed");
            expect(setup?.cleanupTempRef).toBe("removed");

            const productionRuntime: ReviewerAgentRuntime<TaskReviewReviewerOutput> = {
              review: (input) =>
                piReviewerAgentRuntime.review({
                  ...input,
                  decodeOutput: decodeTaskReviewRuntimeOutput,
                }),
            };
            const malformedRun: Pick<Sandbox, "run">["run"] = async () => ({
              iterations: [],
              stdout: "<reviewer-output>{malformed}</reviewer-output>",
              commits: [],
            });
            const malformedOutputSubmission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: {
                  review: (input) =>
                    productionRuntime.review({
                      ...input,
                      sandbox: { run: malformedRun } as Pick<Sandbox, "run">,
                    }),
                },
                persistence: reviews,
              }),
            );
            const malformed = yield* malformedOutputSubmission.submit({
              taskId: publicTaskId("BY-1"),
              now: secondNow,
            });
            expect(malformed).toMatchObject({ ok: true, status: "tooling_failed" });
            if (!malformed.ok || malformed.status !== "tooling_failed") {
              throw new Error("unexpected malformed-output result");
            }
            expect(malformed.toolingFailures).toEqual([
              expect.objectContaining({
                errorKind: "reviewer_output_contract_failed",
                operationName: "decode_task_reviewer_output",
              }),
            ]);
            expect(malformed.task.state).toBe("new");
            expect(yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1"))).toMatchObject(
              {
                id: malformed.reviewId,
                state: "complete",
                outcome: "tooling_failed",
              },
            );
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "keeps the Review active when setup and cleanup both fail",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: passingReviewer([]),
                persistence: reviews,
                createWorkspace: (input) =>
                  Effect.succeed({
                    ok: false,
                    toolingError: {
                      operationName: "create_sandcastle_worktree",
                      tempRefName: `refs/but-why/task-reviews/${input.reviewId}/review`,
                      submittedSha: input.submittedSha,
                      worktreePath: "/leaked-worktree",
                      errorMessage: "setup failed",
                      cleanupResult: { worktree: "failed", tempRef: "removed" },
                    },
                  }),
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

            expect(result).toMatchObject({
              ok: false,
              code: "review_cleanup_pending",
              completionFailure: {
                operationName: "cleanup_disposable_workspace",
                errorMessage:
                  "Disposable workspace cleanup failed after create_sandcastle_worktree: setup failed",
              },
            });
            if (result.ok || result.code !== "review_cleanup_pending") {
              throw new Error("unexpected cleanup result");
            }
            expect(yield* reviews.getActiveByReviewId(result.reviewId)).toBeDefined();
            expect(
              yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1")),
            ).toBeUndefined();
          }),
        );
      }),
    60_000,
  );

  it.scoped(
    "reports and persists Tooling Failure when the workspace returns no phase result",
    () =>
      Effect.gen(function* () {
        const root = yield* prepareInitializedTask();
        yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const reviews = yield* openSqliteTaskReviewPersistence();
            const submission = openTaskSubmission(
              submissionDependencies(root, {
                reviewerAgentRuntime: passingReviewer([]),
                persistence: reviews,
                createWorkspace: (input) =>
                  Effect.succeed({
                    ok: true,
                    setup: {
                      reviewId: input.reviewId,
                      tempRefName: `refs/but-why/task-reviews/${input.reviewId}/review`,
                      submittedSha: input.submittedSha,
                      worktreeHead: input.submittedSha,
                      cleanupWorktree: "not_created",
                      cleanupTempRef: "not_created",
                      createdAt: now,
                    },
                  }),
              }),
            );

            const result = yield* submission.submit({ taskId: publicTaskId("BY-1"), now });

            expect(result).toMatchObject({
              ok: true,
              status: "tooling_failed",
              task: { state: "new" },
              toolingFailures: [
                {
                  errorKind: "infrastructure_tooling_failed",
                  operationName: "run_task_review",
                  errorMessage: "Task Review completed without a result.",
                },
              ],
            });
            if (!result.ok || result.status !== "tooling_failed") {
              throw new Error("unexpected missing-result outcome");
            }
            expect(yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1"))).toMatchObject(
              {
                id: result.reviewId,
                outcome: "tooling_failed",
              },
            );
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
          const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
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
          const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
          const submission = openTaskSubmission(
            submissionDependencies(root, {
              reviewerAgentRuntime: passingReviewer(reviewInputs),
              readRepoConfig: () => ({
                ok: false,
                message: "Global Config is invalid: defaultAgentProfile is missing.",
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
            const runtime: ReviewerAgentRuntime<TaskReviewReviewerOutput> = {
              review: (input) =>
                Effect.sync((): ReviewerAgentResult<TaskReviewReviewerOutput> => {
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

            const recorded = yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1"));
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
            const started = yield* reviews.start({
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
            expect(started).toMatchObject({ ok: true });
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
            });

            const result = yield* abandon.abandon({
              reviewId: "review-abandon",
              reason: "Submission process stopped",
              now,
            });
            expect(result).toEqual({
              ok: true,
              status: "abandoned",
              reviewId: "review-abandon",
              outcome: "tooling_failed",
              task: { id: "BY-1", state: "new" },
              cleanup: { worktree: "removed", tempRef: "removed" },
            });

            expect(existsSync(worktreePath)).toBe(false);
            const tempRef = runTestProcess(
              "git",
              ["rev-parse", "--verify", `${tempRefName}^{commit}`],
              { cwd: root },
            );
            expect(tempRef.status).not.toBe(0);
            expect(yield* reviews.getActiveForTask(publicTaskId("BY-1"))).toBeUndefined();
            const recorded = yield* reviews.latestCompletedReviewForTask(publicTaskId("BY-1"));
            expect(recorded).toMatchObject({
              state: "complete",
              outcome: "tooling_failed",
            });

            expect(
              yield* abandon.abandon({
                reviewId: "review-abandon",
                reason: "Repeated recovery request",
                now,
              }),
            ).toEqual({
              ok: true,
              status: "already_complete",
              reviewId: "review-abandon",
              outcome: "tooling_failed",
              task: { id: "BY-1", state: "new" },
            });
          }),
        );
      }),
    60_000,
  );
});
