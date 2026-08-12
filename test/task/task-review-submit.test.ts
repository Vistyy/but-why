import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../src/agent/reviewerOutput.js";
import { RepositorySqlOperationFailed } from "../../src/contracts/repositoryStorageError.js";
import { expectedDisposableWorkspacePath } from "../../src/disposableWorkspace/disposableWorkspacePath.js";
import type { RunDisposableExactCommitWorkspace } from "../../src/disposableWorkspace/runDisposableExactCommitWorkspace.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { stderrSubmitProgress } from "../../src/submission/submissionProgress.js";
import {
  readCanonicalMainReviewBase,
  verifyRecordedTaskReviewBase,
} from "../../src/task/review/adapters/taskReviewGit.js";
import type { TaskReviewExecution, TaskReviewRecord } from "../../src/task/review/taskReview.js";
import type { TaskReviewPersistence } from "../../src/task/review/taskReviewPersistence.js";
import {
  openTaskReviewUseCases,
  recordTaskReviewExecutionWithRetry,
} from "../../src/task/review/taskReviewUseCases.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

it.effect("retries an idempotent Task Review execution record after an uncertain SQL failure", () =>
  Effect.gen(function* () {
    let attempts = 0;
    yield* recordTaskReviewExecutionWithRetry(
      () => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(
              new RepositorySqlOperationFailed({
                operationName: "record Task Review execution",
                cause: new Error("commit outcome unavailable"),
              }),
            )
          : Effect.void;
      },
      {
        reviewId: "review-1",
        execution: {
          continuity: "fresh",
          identityFingerprint: "fingerprint",
          durationMs: 1,
          reviewCalls: 1,
          invocationUsage: [null],
          sessionReference: "session-1",
        },
      },
    );

    expect(attempts).toBe(2);
  }),
);

it.effect("reports failed progress for Task Review persistence failures", () =>
  Effect.gen(function* () {
    const taskId = publicTaskId("BY-1");
    const profile = {
      agentProfile: "review",
      scope: "global" as const,
      profile: { agentRuntime: "pi" as const },
    };
    const policy = {
      profile,
      builtInInstructions: taskReviewBuiltInInstructions,
      guidance: null,
    };
    let active: TaskReviewRecord | undefined;
    let session: Parameters<TaskReviewPersistence["saveReviewerSession"]>[0] | undefined;
    let failWorkspaceCleanupPersistence = false;
    const executionAttempts: TaskReviewExecution[] = [];
    const persistence: TaskReviewPersistence = {
      reuseJudgment: () => Effect.succeed(undefined),
      admit: (input) => {
        const proposal = { title: "Review me", description: "Exact proposal", dependencyIds: [] };
        active = {
          id: input.reviewId,
          taskId,
          proposal,
          dependencyEvidence: [],
          policy,
          baseRef: input.baseRef,
          baseCommit: input.baseCommit,
          workspacePath: input.workspacePath,
          state: "running",
          outcome: null,
          workspaceCleanup: "not_created",
          toolingFailure: null,
          abandonReason: null,
          findings: [],
          sessions: [],
          transcripts: [],
          createdAt: input.now,
          updatedAt: input.now,
        };
        return Effect.succeed({
          ok: true as const,
          review: active,
          proposal,
          dependencyEvidence: [],
        });
      },
      recordCleanup: (_reviewId, cleanup, now) =>
        failWorkspaceCleanupPersistence
          ? Effect.fail(
              new RepositorySqlOperationFailed({
                operationName: "record workspace cleanup",
                cause: new Error("workspace cleanup persistence unavailable"),
              }),
            )
          : Effect.sync(() => {
              if (active !== undefined)
                active = { ...active, workspaceCleanup: cleanup, updatedAt: now };
            }),
      complete: () =>
        Effect.succeed({ ok: false as const, code: "task_review_not_active" as const }),
      abandon: () =>
        Effect.succeed({ ok: false as const, code: "task_review_not_active" as const }),
      getById: () => Effect.succeed(active),
      getLatestForTask: () => Effect.succeed(active),
      listForTask: () => Effect.succeed(active === undefined ? [] : [active]),
      getReviewerSession: () => Effect.succeed(session),
      saveReviewerSession: (record) =>
        Effect.sync(() => {
          session = record;
        }),
      removeReviewerSession: () =>
        Effect.sync(() => {
          session = undefined;
        }),
      recordExecution: (input) => {
        executionAttempts.push(input.execution);
        return Effect.fail(
          new RepositorySqlOperationFailed({
            operationName: "record Task Review execution",
            cause: new Error("commit outcome unavailable"),
          }),
        );
      },
      recordTranscripts: () => Effect.void,
      recordActiveFailure: (_reviewId, failure, now) =>
        Effect.sync(() => {
          if (active !== undefined) active = { ...active, toolingFailure: failure, updatedAt: now };
        }),
      proposalIsCurrent: () => Effect.succeed(true),
    };
    const runWorkspace: RunDisposableExactCommitWorkspace = (input) =>
      Effect.gen(function* () {
        const workspaceResult =
          input.runInWorkspace === undefined
            ? undefined
            : yield* input.runInWorkspace({
                commandExecutor: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
                worktreePath: createTestWorkspace(),
              });
        if (input.recordWorkspaceCleanup !== undefined) {
          yield* input.recordWorkspaceCleanup({ workspace: "removed" });
        }
        return { ok: true as const, ...(workspaceResult === undefined ? {} : { workspaceResult }) };
      });
    const reviewer: ReviewerAgentRuntime<ReviewerOutput> = {
      review: () =>
        Effect.succeed({
          ok: true as const,
          report: { findings: [] },
          attempts: 1,
          stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
          sessionReference: "session-1",
        }),
    };
    const progressOutput: string[] = [];
    const reviews = openTaskReviewUseCases({
      mainCheckoutRoot: createTestWorkspace(),
      loadRepoConfig: () => ({ ok: true, config: { taskPrefix: "BY" } }),
      resolvePolicy: () => ({ ok: true, policy: { profile, snapshot: policy } }),
      persistence,
      reviewerSessionStorageRoot: createTestWorkspace(),
      reviewerRuntime: reviewer,
      reviewerExecutor: { execute: () => Effect.die("Reviewer Runtime must not use executor") },
      readReviewBase: () =>
        Effect.succeed({ ok: true, base: { ref: "refs/heads/main", commit: "a".repeat(40) } }),
      verifyReviewBase: () => Effect.succeed({ ok: true }),
      runWorkspace,
      cleanupWorkspace: () => Effect.succeed({ workspace: "removed" }),
      inspectWorkspace: () => Effect.succeed({ state: "absent" }),
      progress: stderrSubmitProgress((message) => progressOutput.push(message)),
    });

    const result = yield* reviews.submit(taskId, "2026-08-11T12:00:00.000Z");

    expect(result).toMatchObject({
      ok: false,
      code: "task_review_recovery_required",
      review: { toolingFailure: { operation: "record_task_review_execution" } },
    });
    expect(executionAttempts).toHaveLength(2);
    expect(progressOutput).toEqual([
      "Task Review started: profile=review model=unknown thinking=default\n",
      expect.stringMatching(
        /^Task Review failed in \d+(?:h\d+)?(?:m\d+)?s continuity=fresh reviewCalls=1\n$/,
      ),
    ]);
    if (result.ok || result.code !== "task_review_recovery_required") return;
    expect(result.review.toolingFailure?.pendingExecution).toEqual(executionAttempts[0]);

    active = undefined;
    progressOutput.length = 0;
    failWorkspaceCleanupPersistence = true;
    const workspaceFailure = yield* Effect.either(
      reviews.submit(taskId, "2026-08-11T12:01:00.000Z"),
    );
    expect(workspaceFailure._tag).toBe("Left");
    expect(progressOutput).toEqual([
      "Task Review started: profile=review model=unknown thinking=default\n",
      expect.stringMatching(
        /^Task Review failed in \d+(?:h\d+)?(?:m\d+)?s continuity=resumed reviewCalls=1\n$/,
      ),
    ]);
  }),
);

it.effect("returns a reused judgment before every repository and reviewer collaborator", () =>
  Effect.gen(function* () {
    const taskId = publicTaskId("BY-1");
    const calls = {
      reviewBase: 0,
      repoConfig: 0,
      policy: 0,
      workspace: 0,
      reviewer: 0,
    };
    const finding = {
      title: "Retained Finding",
      description: "Retained description",
      evidence: "Retained evidence",
      files: [],
      artifactRefs: [],
    };
    const retainedFindings = [finding] as const;
    const review: TaskReviewRecord = {
      id: "review-reused",
      taskId,
      proposal: { title: "Review me", description: "Exact", dependencyIds: [] },
      dependencyEvidence: [],
      policy: {
        profile: {
          agentProfile: "review",
          scope: "global",
          profile: { agentRuntime: "pi" },
        },
        builtInInstructions: taskReviewBuiltInInstructions,
        guidance: null,
      },
      baseRef: "refs/heads/recorded",
      baseCommit: "b".repeat(40),
      workspacePath: "/tmp/review-reused",
      state: "complete",
      outcome: "blocked",
      workspaceCleanup: "removed",
      toolingFailure: null,
      abandonReason: null,
      findings: retainedFindings,
      sessions: [],
      transcripts: [],
      createdAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:01:00.000Z",
    };
    const unused = () => Effect.die("Unexpected persistence operation");
    const persistence: TaskReviewPersistence = {
      reuseJudgment: () =>
        Effect.succeed({
          ok: true,
          outcome: "blocked",
          review: {
            ...review,
            state: "complete",
            outcome: "blocked",
            toolingFailure: null,
            findings: retainedFindings,
          },
        }),
      admit: unused,
      recordCleanup: unused,
      complete: unused,
      abandon: unused,
      getById: unused,
      getLatestForTask: unused,
      listForTask: unused,
      getReviewerSession: unused,
      saveReviewerSession: unused,
      removeReviewerSession: unused,
      recordExecution: unused,
      recordTranscripts: unused,
      recordActiveFailure: unused,
      proposalIsCurrent: unused,
    };
    const reviews = openTaskReviewUseCases({
      mainCheckoutRoot: createTestWorkspace(),
      loadRepoConfig: () => {
        calls.repoConfig += 1;
        return { ok: true, config: { taskPrefix: "BY" } };
      },
      resolvePolicy: () => {
        calls.policy += 1;
        return { ok: false, message: "must not resolve" };
      },
      persistence,
      reviewerSessionStorageRoot: createTestWorkspace(),
      reviewerRuntime: {
        review: () => {
          calls.reviewer += 1;
          return Effect.die("must not review");
        },
      },
      reviewerExecutor: { execute: () => Effect.die("must not execute") },
      readReviewBase: () => {
        calls.reviewBase += 1;
        return Effect.succeed({
          ok: true,
          base: { ref: "refs/heads/main", commit: "a".repeat(40) },
        });
      },
      verifyReviewBase: () => Effect.succeed({ ok: true }),
      runWorkspace: () => {
        calls.workspace += 1;
        return Effect.die("must not create workspace");
      },
      cleanupWorkspace: () => Effect.die("must not clean workspace"),
      inspectWorkspace: () => Effect.die("must not inspect workspace"),
    });

    expect(yield* reviews.submit(taskId, "2026-08-11T12:05:00.000Z")).toMatchObject({
      ok: true,
      outcome: "blocked",
      review: {
        id: "review-reused",
        baseCommit: "b".repeat(40),
        findings: [{ title: "Retained Finding" }],
      },
    });
    expect(calls).toEqual({
      reviewBase: 0,
      repoConfig: 0,
      policy: 0,
      workspace: 0,
      reviewer: 0,
    });
  }),
);

const passingReviewer: ReviewerAgentRuntime<ReviewerOutput> = {
  review: () =>
    Effect.succeed({
      ok: true,
      report: { findings: [] },
      attempts: 1,
      stdout: `<reviewer-output>{"findings":[]}</reviewer-output>`,
    }),
};

it.effect(
  "verifies the recorded Task Review Base without requiring its branch tip to remain fixed",
  () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      expect(
        runTestProcess("git", ["config", "user.name", "But Why Test"], { cwd: root }).status,
      ).toBe(0);
      expect(
        runTestProcess("git", ["config", "user.email", "but-why@example.test"], { cwd: root })
          .status,
      ).toBe(0);
      expect(runTestProcess("git", ["branch", "-M", "main"], { cwd: root }).status).toBe(0);
      writeFileSync(join(root, "initial.txt"), "initial\n");
      expect(runTestProcess("git", ["add", "initial.txt"], { cwd: root }).status).toBe(0);
      expect(runTestProcess("git", ["commit", "-m", "Initial"], { cwd: root }).status).toBe(0);
      const base = yield* readCanonicalMainReviewBase(root);
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      writeFileSync(join(root, "advance.txt"), "advance\n");
      expect(runTestProcess("git", ["add", "advance.txt"], { cwd: root }).status).toBe(0);
      expect(runTestProcess("git", ["commit", "-m", "Advance main"], { cwd: root }).status).toBe(0);
      expect(yield* verifyRecordedTaskReviewBase(root, base.base)).toEqual({ ok: true });
      expect(
        yield* verifyRecordedTaskReviewBase(root, {
          ...base.base,
          ref: "refs/heads/not-main",
        }),
      ).toMatchObject({ ok: false, message: expect.stringContaining("ref") });
      expect(
        yield* verifyRecordedTaskReviewBase(root, {
          ...base.base,
          commit: "f".repeat(40),
        }),
      ).toMatchObject({ ok: false, message: expect.stringContaining("commit") });
    }),
);

it.effect("preserves repository load errors for Task Review commands", () =>
  Effect.gen(function* () {
    const root = createGitRepo();

    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", "review-id"]);

    expect(shown.status).toBe(1);
    expect(JSON.parse(shown.stdout)).toEqual({
      error: {
        code: "not_initialized",
        message: "This workspace is not initialized for But Why?.",
      },
      help: ["Run `by init --task-prefix BY` in the repository root."],
    });
  }),
);

it.effect("rejects a missing required default Agent Profile before Task Review admission", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    expect(initialized.status).toBe(0);
    commitButWhyConfigAndRecordDefault(root);
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review me",
      "--file",
      proposalPath,
    ]);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"]);
    expect(submitted.status).toBe(1);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      error: { code: "task_review_config_invalid" },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({ task: { review: null } });
  }),
);

it.effect("rejects missing Review Base guidance before Task Review admission", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        taskPrefix: "BY",
        review: { task: { instructionsFile: ".but-why/reviewers/missing.md" } },
      }),
    );
    expect(runTestProcess("git", ["add", ".but-why/config.json"], { cwd: root }).status).toBe(0);
    expect(
      runTestProcess("git", ["commit", "-m", "Configure missing guidance"], { cwd: root }).status,
    ).toBe(0);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: {
          review: { agentRuntime: "pi", runtimeConfig: { model: "provider/model" } },
        },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review me",
      "--file",
      proposalPath,
    ]);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
    });
    expect(submitted.status).toBe(1);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      error: {
        code: "task_review_config_invalid",
        message: expect.stringContaining("Review Base"),
      },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({ task: { review: null } });
  }),
);

it.effect("rejects a Review Base directory as guidance before Task Review admission", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    mkdirSync(join(root, ".but-why", "reviewers", "task"), { recursive: true });
    writeFileSync(join(root, ".but-why", "reviewers", "task", "guidance.md"), "Guidance\n");
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        taskPrefix: "BY",
        review: { task: { instructionsFile: ".but-why/reviewers/task" } },
      }),
    );
    expect(
      runTestProcess(
        "git",
        ["add", ".but-why/config.json", ".but-why/reviewers/task/guidance.md"],
        { cwd: root },
      ).status,
    ).toBe(0);
    expect(
      runTestProcess("git", ["commit", "-m", "Configure directory guidance"], { cwd: root }).status,
    ).toBe(0);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: {
          review: { agentRuntime: "pi", runtimeConfig: { model: "provider/model" } },
        },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review me",
      "--file",
      proposalPath,
    ]);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
    });
    expect(submitted.status).toBe(1);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      error: { code: "task_review_config_invalid" },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({ task: { review: null } });
  }),
);

it.effect("rejects missing Agent Profile resources before Task Review admission", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: {
          review: {
            agentRuntime: "pi",
            runtimeConfig: {
              model: "provider/model",
              extensions: ["./missing-extension.ts"],
            },
          },
        },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review me",
      "--file",
      proposalPath,
    ]);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
    });
    expect(submitted.status).toBe(1);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      error: { code: "task_review_config_invalid", message: expect.stringContaining("missing") },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({ task: { review: null } });
  }),
);

it.effect("inspects and abandons only one exact Active Task Review workspace", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review me",
      "--file",
      proposalPath,
    ]);
    const loaded = openRepositoryRuntime(root);
    if (!loaded.ok) throw new Error(loaded.error.code);
    const reviewId = "11111111-1111-4111-8111-111111111111";
    const workspacePath = expectedDisposableWorkspacePath(root, reviewId);
    mkdirSync(dirname(workspacePath), { recursive: true });
    const added = runTestProcess(
      "git",
      ["worktree", "add", "--detach", "--", workspacePath, "HEAD"],
      { cwd: root },
    );
    expect(added.status, added.stderr).toBe(0);
    const commit = runTestProcess("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
    yield* Effect.scoped(
      loaded.runtime.provide(
        openSqliteTaskReviewPersistence().pipe(
          Effect.flatMap((reviews) =>
            Effect.gen(function* () {
              yield* reviews.admit({
                reviewId,
                taskId: publicTaskId("BY-1"),
                policy: {
                  profile: {
                    agentProfile: "review",
                    scope: "global",
                    profile: { agentRuntime: "pi" },
                  },
                  builtInInstructions: taskReviewBuiltInInstructions,
                  guidance: null,
                },
                baseRef: "refs/heads/main",
                baseCommit: commit,
                workspacePath,
                now: "2026-08-11T12:00:00.000Z",
              });
              yield* reviews.recordActiveFailure(
                reviewId,
                {
                  operation: "record_task_review_execution",
                  message: "Task Review execution persistence failed twice.",
                  pendingExecution: {
                    continuity: "fresh",
                    identityFingerprint: "fingerprint",
                    durationMs: 5,
                    reviewCalls: 1,
                    invocationUsage: [null],
                    sessionReference: "session-1",
                  },
                },
                "2026-08-11T12:00:01.000Z",
              );
            }),
          ),
        ),
      ),
    );

    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", reviewId]);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: {
        id: reviewId,
        state: "running",
        workspace: { path: workspacePath },
        toolingFailure: {
          operation: "record_task_review_execution",
          pendingExecution: { sessionReference: "session-1" },
        },
        identity: { verified: true, workspace: { state: "matching" } },
      },
    });
    const abandoned = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "abandon",
      reviewId,
      "--reason",
      "Interrupted reviewer",
    ]);
    expect(abandoned.status, abandoned.stdout).toBe(0);
    expect(JSON.parse(abandoned.stdout)).toMatchObject({
      review: {
        state: "complete",
        outcome: "tooling_failed",
        workspace: { cleanup: "removed" },
        sessions: [{ continuity: "fresh", sessionReference: "session-1" }],
      },
    });
    expect(existsSync(workspacePath)).toBe(false);

    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Second review",
      "--file",
      proposalPath,
    ]);
    const mismatchedReviewId = "22222222-2222-4222-8222-222222222222";
    yield* Effect.scoped(
      loaded.runtime.provide(
        openSqliteTaskReviewPersistence().pipe(
          Effect.flatMap((reviews) =>
            reviews.admit({
              reviewId: mismatchedReviewId,
              taskId: publicTaskId("BY-2"),
              policy: {
                profile: {
                  agentProfile: "review",
                  scope: "global",
                  profile: { agentRuntime: "pi" },
                },
                builtInInstructions: taskReviewBuiltInInstructions,
                guidance: null,
              },
              baseRef: "refs/heads/not-main",
              baseCommit: commit,
              workspacePath: expectedDisposableWorkspacePath(root, mismatchedReviewId),
              now: "2026-08-11T12:05:00.000Z",
            }),
          ),
        ),
      ),
    );
    const mismatched = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      mismatchedReviewId,
    ]);
    expect(mismatched.status).toBe(0);
    expect(JSON.parse(mismatched.stdout)).toMatchObject({
      review: { id: mismatchedReviewId, identity: { verified: false } },
      help: [expect.stringContaining("identity problem")],
    });
  }),
);

it.effect("captures and executes the effective Review Base Task Review policy", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    mkdirSync(join(root, ".but-why", "reviewers"), { recursive: true });
    mkdirSync(join(root, "skills", "task"), { recursive: true });
    writeFileSync(join(root, ".but-why", "reviewers", "task.md"), "Repository guidance\n");
    writeFileSync(join(root, "skills", "task", "SKILL.md"), "Task skill\n");
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        taskPrefix: "BY",
        prepare: { command: "true" },
        review: {
          task: {
            agentProfile: { scope: "repo", name: "task-review" },
            instructionsFile: ".but-why/reviewers/task.md",
          },
        },
        agentProfiles: {
          "task-review": {
            agentRuntime: "pi",
            runtimeConfig: {
              model: "provider/repo-model",
              thinking: "high",
              skills: ["skills/task"],
            },
          },
        },
      }),
    );
    expect(
      runTestProcess(
        "git",
        ["add", ".but-why/config.json", ".but-why/reviewers/task.md", "skills/task/SKILL.md"],
        { cwd: root },
      ).status,
    ).toBe(0);
    expect(
      runTestProcess("git", ["commit", "-m", "Configure Task Review"], { cwd: root }).status,
    ).toBe(0);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "default" },
        agentProfiles: {
          default: { agentRuntime: "pi", runtimeConfig: { model: "provider/default" } },
        },
        review: { task: { instructionsFile: "ignored.md" } },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review configured policy",
      "--file",
      proposalPath,
    ]);
    let observed: Parameters<ReviewerAgentRuntime<ReviewerOutput>["review"]>[0] | undefined;
    const progress: string[] = [];
    const reviewer: ReviewerAgentRuntime<ReviewerOutput> = {
      review: (input) => {
        observed = input;
        return passingReviewer.review(input);
      },
    };

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      reviewerAgentRuntime: reviewer,
      writeStderr: (message) => progress.push(message),
    });

    expect(submitted.status, submitted.stdout).toBe(0);
    expect(progress).toEqual([
      "Repository Preparation started\n",
      expect.stringMatching(/^Repository Preparation passed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
      "Task Review started: profile=task-review model=provider/repo-model thinking=high\n",
      expect.stringMatching(
        /^Task Review passed in \d+(?:h\d+)?(?:m\d+)?s continuity=fresh reviewCalls=1\n$/,
      ),
    ]);
    expect(observed).toMatchObject({
      profile: {
        agentProfile: "task-review",
        scope: "repo",
        profile: { runtimeConfig: { model: "provider/repo-model", skills: ["skills/task"] } },
      },
    });
    expect(observed?.prompt).toContain("Repository guidance");
    expect(observed?.prompt).toContain("remain controlling if the guidance conflicts");
    const submittedOutput = JSON.parse(submitted.stdout) as { review: { id: string } };
    expect(submittedOutput).toMatchObject({
      review: { outcome: "passed" },
      task: { id: "BY-1", state: "todo" },
    });
    const shown = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      submittedOutput.review.id,
    ]);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: {
        policy: {
          profile: {
            agentProfile: "task-review",
            scope: "repo",
            profile: { runtimeConfig: { model: "provider/repo-model" } },
          },
          guidance: { content: "Repository guidance\n", source: "repo" },
        },
      },
    });

    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Blocked review",
      "--file",
      proposalPath,
    ]);
    const blockedProgress: string[] = [];
    const blocked = yield* runByInProcessEffect(root, ["task", "submit", "BY-2"], undefined, {
      globalConfigPath,
      reviewerAgentRuntime: {
        review: () =>
          Effect.succeed({
            ok: true as const,
            report: {
              findings: [
                {
                  title: "Intent gap",
                  description: "The proposal omits one required outcome.",
                  evidence: "The proposal text has no required outcome.",
                  files: [],
                  artifactRefs: [],
                },
              ],
            },
            attempts: 1,
            stdout: "<reviewer-output>blocked</reviewer-output>",
          }),
      },
      writeStderr: (message) => blockedProgress.push(message),
    });
    expect(blocked.status).toBe(1);
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      error: { code: "task_review_findings" },
    });
    expect(blockedProgress.at(-1)).toMatch(
      /^Task Review failed in \d+(?:h\d+)?(?:m\d+)?s continuity=fresh reviewCalls=1\n$/,
    );
  }),
);

it.effect("submits one exact Task proposal through a fresh exact Review Base workspace", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    expect(initialized.status).toBe(0);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: {
          review: {
            agentRuntime: "pi",
            runtimeConfig: { model: "provider/model", thinking: "high" },
          },
        },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    const created = yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review me",
      "--file",
      proposalPath,
    ]);
    expect(created.status).toBe(0);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      reviewerAgentRuntime: passingReviewer,
      writeStderr: () => {
        throw new Error("stderr unavailable");
      },
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    const output = JSON.parse(submitted.stdout) as { review: { id: string } };
    expect(output).toEqual({
      review: { id: output.review.id, outcome: "passed" },
      task: { id: "BY-1", state: "todo" },
      help: ["Run `by task show BY-1` to inspect its startability and next action."],
    });
    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", output.review.id]);
    const shownOutput = JSON.parse(shown.stdout) as {
      review: { proposalCurrent: boolean; workspace: { path: string; cleanup: string } };
    };
    expect(shownOutput.review.proposalCurrent).toBe(true);
    expect(shownOutput.review.workspace.cleanup).toBe("removed");
    expect(existsSync(shownOutput.review.workspace.path)).toBe(false);
    const task = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(JSON.parse(task.stdout)).toMatchObject({ task: { state: "todo" } });
  }),
);

it.effect(
  "continues a compatible Task Reviewer Session with the current proposal diff and exposes transcripts",
  () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const globalConfigPath = join(root, "global.json");
      yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
      commitButWhyConfigAndRecordDefault(root);
      const globalConfig = JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: {
          review: { agentRuntime: "pi", runtimeConfig: { model: "provider/model" } },
        },
      });
      writeFileSync(globalConfigPath, globalConfig);
      const proposalPath = join(root, "proposal.txt");
      writeFileSync(proposalPath, "Initial proposal");
      yield* runByInProcessEffect(root, [
        "task",
        "create",
        "--title",
        "Review continuity",
        "--file",
        proposalPath,
      ]);

      const observed: Parameters<ReviewerAgentRuntime<ReviewerOutput>["review"]>[0][] = [];
      const finding = {
        title: "Proposal needs revision",
        description: "Revise the proposal before approval.",
        evidence: "The reviewer requested a revision.",
        files: [],
        artifactRefs: [],
      };
      const reviewer: ReviewerAgentRuntime<ReviewerOutput> = {
        review: (input) => {
          observed.push(input);
          const storageRoot = input.sessionStorageRoot;
          if (storageRoot === undefined) throw new Error("Expected Task Reviewer Session storage");
          const sessionId = input.resumeSession ?? "task-session-1";
          mkdirSync(storageRoot, { recursive: true });
          const sessionFilePath = join(storageRoot, `review_${sessionId}.jsonl`);
          writeFileSync(
            sessionFilePath,
            `${JSON.stringify({ type: "session", id: sessionId, cwd: input.commandCwd })}\n`,
          );
          return Effect.succeed({
            ok: true as const,
            report: { findings: [finding] },
            attempts: 1,
            stdout: `<reviewer-output>${JSON.stringify({ findings: [finding] })}</reviewer-output>`,
            sessionReference: sessionId,
            sessionFilePath,
          });
        },
      };

      const first = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
        globalConfigPath,
        reviewerAgentRuntime: reviewer,
      });
      expect(first.status, first.stdout).toBe(1);
      const firstId = (JSON.parse(first.stdout) as { error: { review: { id: string } } }).error
        .review.id;

      const repoConfigPath = join(root, ".but-why", "config.json");
      const repoConfig = readFileSync(repoConfigPath, "utf8");
      writeFileSync(repoConfigPath, "{");
      writeFileSync(globalConfigPath, "{");
      const reused = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
        globalConfigPath,
        reviewerAgentRuntime: reviewer,
      });
      expect(reused.status, reused.stdout).toBe(1);
      expect(JSON.parse(reused.stdout)).toMatchObject({
        error: {
          code: "task_review_findings",
          review: { id: firstId, outcome: "blocked", findings: [{ title: finding.title }] },
        },
      });
      expect(observed).toHaveLength(1);
      writeFileSync(repoConfigPath, repoConfig);
      writeFileSync(globalConfigPath, globalConfig);

      const drafted = yield* runByInProcessEffect(root, ["task", "context", "draft", "BY-1"]);
      const draftPath = (JSON.parse(drafted.stdout) as { draft: { path: string } }).draft.path;
      writeFileSync(draftPath, "Changed proposal\n");
      const applied = yield* runByInProcessEffect(root, ["task", "context", "apply", "BY-1"]);
      expect(applied.status, applied.stdout).toBe(0);

      const second = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
        globalConfigPath,
        reviewerAgentRuntime: reviewer,
      });
      expect(second.status, second.stdout).toBe(1);
      expect(observed).toHaveLength(2);
      expect(observed[1]?.resumeSession).toBe("task-session-1");
      expect(observed[1]?.prompt).toContain("Changed proposal");
      expect(observed[1]?.prompt).toContain("Deterministic proposal diff");

      const secondId = (JSON.parse(second.stdout) as { error: { review: { id: string } } }).error
        .review.id;
      const history = yield* runByInProcessEffect(root, ["task", "reviews", "BY-1"]);
      expect(history.status, history.stdout).toBe(0);
      expect(JSON.parse(history.stdout)).toEqual({
        taskId: "BY-1",
        reviewCount: 2,
        reviews: [
          {
            id: firstId,
            state: "complete",
            outcome: "blocked",
            findingCount: 1,
            toolingFailure: null,
            workspaceCleanup: "removed",
            sessionCount: 1,
            transcriptCount: 1,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            nextActions: [`Run \`by task-review show ${firstId}\` to inspect this Review.`],
          },
          {
            id: secondId,
            state: "complete",
            outcome: "blocked",
            findingCount: 1,
            toolingFailure: null,
            workspaceCleanup: "removed",
            sessionCount: 1,
            transcriptCount: 1,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            nextActions: [`Run \`by task-review show ${secondId}\` to inspect this Review.`],
          },
        ],
        help: ["Run `by task-review show <review-id>` to inspect one Review."],
      });
      const shown = yield* runByInProcessEffect(root, ["task-review", "show", secondId]);
      expect(shown.status, shown.stdout).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        review: {
          proposal: { description: "Changed proposal\n" },
          sessions: [{ continuity: "resumed", sessionReference: "task-session-1" }],
          transcripts: [{ piSessionId: "task-session-1" }],
        },
      });

      const sessionStorageRoot = observed[1]?.sessionStorageRoot;
      if (sessionStorageRoot === undefined) throw new Error("Expected session storage root");
      const invalidTranscript = join(sessionStorageRoot, "invalid.jsonl");
      writeFileSync(invalidTranscript, "{}\n");
      const nextDrafted = yield* runByInProcessEffect(root, ["task", "context", "draft", "BY-1"]);
      const nextDraftPath = (JSON.parse(nextDrafted.stdout) as { draft: { path: string } }).draft
        .path;
      writeFileSync(nextDraftPath, "Another changed proposal\n");
      expect((yield* runByInProcessEffect(root, ["task", "context", "apply", "BY-1"])).status).toBe(
        0,
      );
      const failedIndex = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
        globalConfigPath,
        reviewerAgentRuntime: reviewer,
      });
      expect(failedIndex.status).toBe(1);
      expect(JSON.parse(failedIndex.stdout)).toMatchObject({
        error: {
          code: "task_review_recovery_required",
          review: {
            id: expect.any(String),
            reviewBase: { ref: "refs/heads/main", commit: expect.any(String) },
            workspace: { path: expect.any(String), cleanup: "removed" },
          },
        },
      });
      const failedReviewId = (
        JSON.parse(failedIndex.stdout) as {
          error: { review: { id: string } };
        }
      ).error.review.id;
      const failedShown = yield* runByInProcessEffect(root, [
        "task-review",
        "show",
        failedReviewId,
      ]);
      expect(JSON.parse(failedShown.stdout)).toMatchObject({
        review: {
          state: "running",
          toolingFailure: { operation: "index_task_reviewer_transcripts" },
          sessions: [{ continuity: "resumed", sessionReference: "task-session-1" }],
        },
      });
      rmSync(invalidTranscript);
      const abandoned = yield* runByInProcessEffect(root, [
        "task",
        "review",
        "abandon",
        failedReviewId,
        "--reason",
        "Indexing interrupted completion",
      ]);
      expect(abandoned.status, abandoned.stdout).toBe(0);
      expect(JSON.parse(abandoned.stdout)).toMatchObject({
        review: {
          id: failedReviewId,
          state: "complete",
          outcome: "tooling_failed",
          sessions: [{ continuity: "resumed", sessionReference: "task-session-1" }],
          transcripts: [{ piSessionId: "task-session-1" }],
        },
      });
    }),
);
