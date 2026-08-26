import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { AgentSessionPersistence } from "../../src/agent/agentSession/agentSession.js";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import { restoreDisposableWorkspace } from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { DisposableWorkspaceRestorationFailed } from "../../src/disposableWorkspace/disposableWorkspace.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import {
  readCurrentWorktreeReviewBase,
  verifyRecordedTaskReviewBase,
} from "../../src/task/review/adapters/taskReviewGit.js";
import type { TaskReviewRecord } from "../../src/task/review/taskReview.js";
import type { TaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";
import type { TaskReviewPersistence } from "../../src/task/review/taskReviewPersistence.js";
import { openTaskReviewUseCases } from "../../src/task/review/taskReviewUseCases.js";
import { expectedTaskReviewWorkspacePath } from "../../src/task/review/taskReviewWorkspace.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const defaultAgentPersistence = (): AgentSessionPersistence => ({
  beginInvocation: ({ agentSessionId, configuration, createdAt }) => {
    const sessionId = agentSessionId ?? 1;
    const continuation = {
      id: 1,
      agentSessionId: sessionId,
      harness: "pi" as const,
      provider: configuration.provider ?? null,
      model: configuration.model,
      thinking: configuration.thinking ?? null,
      transcriptPath: null,
      unusableReason: null,
    };
    return Effect.succeed({
      ok: true as const,
      dispatch: {
        agentSessionId: sessionId,
        continuation,
        invocation: {
          id: 1,
          continuationId: continuation.id,
          createdAt,
          settledAt: null,
          settlementKind: null,
          usage: null,
          continuation,
        },
        resumed: false,
        piSessionId: "by-agent-1",
      },
    });
  },
  settleInvocation: () => Effect.void,
  readInvocationHistory: () => Effect.succeed([]),
});

const defaultAgentLink = () => () => Effect.void;

it.effect("records Task Review preparation integrity failures and skips the reviewer", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        idPrefix: "BY",
        prepare: { command: "printf changed > .but-why/config.json" },
      }),
    );
    expect(runTestProcess("git", ["add", ".but-why/config.json"], { cwd: root }).status).toBe(0);
    expect(
      runTestProcess("git", ["commit", "-m", "Configure preparation"], { cwd: root }).status,
    ).toBe(0);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: { review: { agentRuntime: "pi", runtimeConfig: { model: "test-model" } } },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Prepare",
      "--file",
      proposalPath,
    ]);
    let reviewerCalls = 0;
    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: {
        review: () => {
          reviewerCalls += 1;
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: `<reviewer-output>{"findings":[]}</reviewer-output>`,
          });
        },
      },
    });
    expect(submitted.status).toBe(1);
    expect(reviewerCalls).toBe(0);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      error: {
        code: "task_review_tooling_failed",
        review: {
          outcome: "tooling_failed",
          toolingFailure: { operation: "verify_task_review_workspace" },
        },
      },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", "1"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: { workspace: { cleanup: "removed" } },
    });
  }),
);

it.effect("restores Task Review state before an output-correction retry", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    const originalConfig = readFileSync(join(root, ".but-why", "config.json"), "utf8");
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: { review: { agentRuntime: "pi", runtimeConfig: { model: "test-model" } } },
      }),
    );
    const proposalPath = join(root, "proposal.txt");
    writeFileSync(proposalPath, "Exact proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Reviewer",
      "--file",
      proposalPath,
    ]);
    let reviewerCalls = 0;
    let observedConfig = "";
    let observedStatus = "";
    let observedUntracked = true;
    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: {
        review: (input) => {
          reviewerCalls += 1;
          const cwd = input.commandCwd ?? ".";
          if (reviewerCalls === 1) {
            const sessionStorageRoot = input.sessionStorageRoot;
            if (sessionStorageRoot === undefined)
              throw new Error("Expected reviewer session storage root");
            mkdirSync(sessionStorageRoot, { recursive: true });
            const sessionFilePath = join(sessionStorageRoot, "reviewer.jsonl");
            writeFileSync(
              sessionFilePath,
              `${JSON.stringify({ type: "session", id: input.sessionId, cwd })}\n`,
            );
            writeFileSync(join(cwd, ".but-why", "config.json"), "changed\n");
            expect(runTestProcess("git", ["add", ".but-why/config.json"], { cwd }).status).toBe(0);
            writeFileSync(join(cwd, "reviewer-untracked"), "remove\n");
            return Effect.succeed({
              ok: false as const,
              failure: {
                kind: "output_contract" as const,
                operationName: "decode_reviewer_output",
                message: "Structured output correction is required.",
                sessionReference: "session-1",
              },
              sessionUsability: "unknown" as const,
              attempts: 1,
              stdout: "invalid output",
              sessionReference: "session-1",
              sessionFilePath,
            });
          }
          observedConfig = readFileSync(join(cwd, ".but-why", "config.json"), "utf8");
          observedStatus = runTestProcessOrThrow("git", ["status", "--porcelain=v1"], { cwd });
          observedUntracked = existsSync(join(cwd, "reviewer-untracked"));
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: `<reviewer-output>{"findings":[]}</reviewer-output>`,
          });
        },
      },
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    expect(reviewerCalls).toBe(2);
    expect(observedConfig).toBe(originalConfig);
    expect(observedStatus).toBe("");
    expect(observedUntracked).toBe(false);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      review: { outcome: "passed" },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", "1"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: { workspace: { cleanup: "removed" } },
    });
  }),
);

it.effect("observes final Task Review restoration and restoration failure", () =>
  Effect.gen(function* () {
    const runScenario = (scenario: "passed" | "restoration_failure" | "interrupted") =>
      Effect.gen(function* () {
        const root = createGitRepo();
        runTestProcess("git", ["config", "user.name", "But Why Test"], { cwd: root });
        runTestProcess("git", ["config", "user.email", "but-why@example.test"], { cwd: root });
        mkdirSync(join(root, ".but-why"), { recursive: true });
        writeFileSync(join(root, ".but-why", "config.json"), "candidate\n");
        runTestProcess("git", ["add", ".but-why/config.json"], { cwd: root });
        runTestProcess("git", ["commit", "-m", "Candidate"], { cwd: root });
        const baseCommit = runTestProcess("git", ["rev-parse", "HEAD"], {
          cwd: root,
        }).stdout.trim();
        const repositoryCommonDirectory = runTestProcess(
          "git",
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          { cwd: root },
        ).stdout.trim();
        const workspacePath = expectedTaskReviewWorkspacePath(repositoryCommonDirectory, 1);
        mkdirSync(dirname(workspacePath), { recursive: true });
        runTestProcess("git", ["worktree", "add", "--detach", "--", workspacePath, baseCommit], {
          cwd: root,
        });
        const taskId = publicTaskId("BY-1");
        const reviewerProfile = {
          agentProfile: "review",
          scope: "global" as const,
          profile: { agentRuntime: "pi" as const, runtimeConfig: { model: "test-model" } },
        };
        const reviewerPolicy = {
          profile: reviewerProfile,
          builtInInstructions: taskReviewBuiltInInstructions,
          guidance: null,
        };
        const review: TaskReviewRecord = {
          id: 1,
          taskId,
          proposal: { title: "Review me", description: "Exact", dependencyIds: [] },
          dependencyEvidence: [],
          baseRef: "refs/heads/main",
          baseCommit,
          workspacePath,
          state: "running",
          outcome: null,
          workspaceCleanup: "not_created",
          cleanupBlockingReason: null,
          toolingFailure: null,
          findings: [],
        };
        let restoredStatus = "not-observed";
        let restoredUntracked = true;
        let reviewerCalls = 0;
        const persistence: TaskReviewPersistence = {
          getCompletedSimplificationAdvice: () => Effect.succeed(undefined),
          recordSimplificationAdviceFailure: () => Effect.void,
          linkSimplificationAdviceInvocation: defaultAgentLink,
          settleSimplificationAdvice: () => () => Effect.void,
          reuseJudgment: () => Effect.succeed(undefined),
          checkAdmission: () => Effect.succeed(undefined),
          admit: () =>
            Effect.succeed({
              ok: true as const,
              review,
              policy: reviewerPolicy,
              proposal: review.proposal,
              dependencyEvidence: [],
            }),
          recordCleanup: () => Effect.void,
          complete: (completion) =>
            completion.toolingFailure === undefined
              ? Effect.succeed({
                  ok: true as const,
                  outcome: "passed" as const,
                  review: {
                    ...review,
                    state: "complete" as const,
                    outcome: "passed" as const,
                    workspaceCleanup: "removed" as const,
                    toolingFailure: null,
                    findings: [],
                  },
                  task: { id: taskId, state: "todo" as const },
                })
              : Effect.succeed({
                  ok: true as const,
                  outcome: "tooling_failed" as const,
                  review: {
                    ...review,
                    state: "complete" as const,
                    outcome: "tooling_failed" as const,
                    workspaceCleanup: "removed" as const,
                    toolingFailure: completion.toolingFailure,
                    findings: completion.findings,
                  },
                  task: { id: taskId, state: "todo" as const },
                }),
          abandon: () => Effect.die("Unexpected persistence operation"),
          getById: () => Effect.succeed(review),
          getLatestForTask: () => Effect.succeed(undefined),
          listForTask: () => Effect.succeed([]),
          getReviewerAgentSession: () => Effect.succeed(undefined),
          getReviewerConfiguration: () => Effect.succeed(undefined),
          linkAgentInvocation: defaultAgentLink,
          settleAgentReview: () => () => Effect.void,
          recordActiveFailure: () => Effect.die("Unexpected persistence operation"),
          proposalIsCurrent: () => Effect.succeed(true),
        };
        const commandExecutor = (command: string, options?: { readonly cwd?: string }) =>
          Effect.sync(() => {
            const result = runTestProcess("bash", ["-lc", command], {
              cwd: options?.cwd ?? workspacePath,
            });
            return {
              exitCode: result.status ?? 1,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          });
        const reviews = openTaskReviewUseCases({
          repositoryRoot: root,
          repositoryCommonDirectory,
          loadRepoConfig: () => ({ ok: true as const, config: { idPrefix: "BY" } }),
          resolvePolicy: () => ({
            ok: true as const,
            policy: { snapshot: reviewerPolicy, profile: reviewerProfile },
          }),
          resolveSimplificationAdvicePolicy: () => ({
            ok: false as const,
            message: "Test Underengineer is unavailable.",
          }),
          persistence,
          agentSessionStorageRoot: createTestWorkspace(),
          agentPersistence: defaultAgentPersistence(),
          underengineerRuntime: {
            review: () =>
              Effect.succeed({
                ok: false as const,
                failure: {
                  kind: "process_execution" as const,
                  operationName: "test_underengineer",
                  message: "Test Underengineer is unavailable.",
                },
                sessionUsability: "unknown" as const,
                attempts: 1,
                stdout: "",
              }),
          },
          reviewerRuntime: {
            review: (input) =>
              Effect.gen(function* () {
                reviewerCalls += 1;
                const cwd = input.commandCwd ?? workspacePath;
                writeFileSync(join(cwd, ".but-why/config.json"), "changed\n");
                runTestProcess("git", ["add", ".but-why/config.json"], { cwd });
                writeFileSync(join(cwd, "reviewer-untracked"), "remove\n");
                if (scenario === "interrupted") return yield* Effect.interrupt;
                return {
                  ok: true as const,
                  report: { findings: [] },
                  attempts: 1,
                  stdout: `<reviewer-output>{"findings":[]}</reviewer-output>`,
                };
              }),
          },
          reviewerExecutor: { execute: () => Effect.die("unused") },
          readReviewBase: () =>
            Effect.succeed({
              ok: true as const,
              base: { ref: "refs/heads/main", commit: baseCommit },
            }),
          verifyReviewBase: () => Effect.succeed({ ok: true as const }),
          runWorkspace: (workspaceInput) =>
            workspaceInput.runInWorkspace === undefined
              ? Effect.succeed({ ok: true as const })
              : workspaceInput
                  .runInWorkspace({ commandExecutor, worktreePath: workspacePath })
                  .pipe(Effect.map((workspaceResult) => ({ ok: true as const, workspaceResult }))),
          restoreWorkspace: (restoreInput) =>
            restoreDisposableWorkspace(restoreInput).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  restoredStatus = runTestProcessOrThrow("git", ["status", "--porcelain=v1"], {
                    cwd: workspacePath,
                  });
                  restoredUntracked = existsSync(join(workspacePath, "reviewer-untracked"));
                }),
              ),
              Effect.flatMap(() =>
                scenario === "restoration_failure"
                  ? Effect.fail(new DisposableWorkspaceRestorationFailed({ message: "forced" }))
                  : Effect.void,
              ),
            ),
          cleanupWorkspace: () => {
            runTestProcess("git", ["worktree", "remove", "--force", "--", workspacePath], {
              cwd: root,
            });
            return Effect.succeed({ workspace: "removed" as const });
          },
          inspectWorkspace: () => Effect.succeed({ state: "absent" as const }),
        });
        const result = yield* reviews.submit(taskId, "2026-08-11T12:05:00.000Z");
        return { result, restoredStatus, restoredUntracked, reviewerCalls };
      });

    const passed = yield* runScenario("passed");
    expect(passed.result).toMatchObject({ ok: true, outcome: "passed" });
    expect(passed.restoredStatus).toBe("");
    expect(passed.restoredUntracked).toBe(false);

    const failed = yield* runScenario("restoration_failure");
    expect(failed.result).toMatchObject({ ok: true, outcome: "tooling_failed" });
    expect(failed.restoredStatus).toBe("");
    expect(failed.restoredUntracked).toBe(false);

    const interrupted = yield* runScenario("interrupted");
    expect(interrupted.result).toMatchObject({ ok: true, outcome: "tooling_failed" });
    expect(interrupted.restoredStatus).toBe("");
    expect(interrupted.restoredUntracked).toBe(false);
    expect(interrupted.reviewerCalls).toBe(1);
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
    const review: TaskReviewRecord = {
      id: 1,
      taskId,
      proposal: { title: "Review me", description: "Exact", dependencyIds: [] },
      dependencyEvidence: [],
      reviewerConfiguration: {
        profile: {
          agentProfile: "review",
          scope: "global",
          profile: { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
        },
        builtInInstructions: taskReviewBuiltInInstructions,
        guidance: null,
      },
      baseRef: "refs/heads/recorded",
      baseCommit: "b".repeat(40),
      workspacePath: "/tmp/review-reused",
      state: "complete",
      outcome: "passed",
      workspaceCleanup: "removed",
      cleanupBlockingReason: null,
      toolingFailure: null,
      findings: [],
    };
    const unused = () => Effect.die("Unexpected persistence operation");
    const persistence: TaskReviewPersistence = {
      getCompletedSimplificationAdvice: () => Effect.succeed(undefined),
      recordSimplificationAdviceFailure: () => Effect.void,
      linkSimplificationAdviceInvocation: defaultAgentLink,
      settleSimplificationAdvice: () => () => Effect.void,
      reuseJudgment: () =>
        Effect.succeed({
          ok: true,
          outcome: "passed",
          review: {
            ...review,
            state: "complete",
            outcome: "passed",
            toolingFailure: null,
            findings: [],
          },
          task: { id: taskId, state: "todo" },
        }),
      checkAdmission: unused,
      admit: unused,
      recordCleanup: unused,
      complete: unused,
      abandon: unused,
      getById: unused,
      getLatestForTask: unused,
      listForTask: unused,
      getReviewerAgentSession: unused,
      getReviewerConfiguration: () => Effect.succeed(undefined),
      linkAgentInvocation: defaultAgentLink,
      settleAgentReview: () => () => Effect.void,
      recordActiveFailure: unused,
      proposalIsCurrent: unused,
    };
    const reviews = openTaskReviewUseCases({
      repositoryRoot: createTestWorkspace(),
      repositoryCommonDirectory: createTestWorkspace(),
      loadRepoConfig: () => {
        calls.repoConfig += 1;
        return { ok: true, config: { idPrefix: "BY" } };
      },
      resolvePolicy: () => {
        calls.policy += 1;
        return { ok: false, message: "must not resolve" };
      },
      resolveSimplificationAdvicePolicy: () => ({
        ok: false as const,
        message: "must not resolve",
      }),
      persistence,
      agentSessionStorageRoot: createTestWorkspace(),
      agentPersistence: defaultAgentPersistence(),
      underengineerRuntime: {
        review: () => Effect.die("must not review"),
      },
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
      restoreWorkspace: () => Effect.void,
      cleanupWorkspace: () => Effect.die("must not clean workspace"),
      inspectWorkspace: () => Effect.die("must not inspect workspace"),
    });

    expect(yield* reviews.submit(taskId, "2026-08-11T12:05:00.000Z")).toMatchObject({
      ok: true,
      outcome: "passed",
      review: {
        id: 1,
        baseCommit: "b".repeat(40),
        findings: [],
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

const passingReviewer: ReviewerAgentRuntime<TaskReviewerOutput> = {
  review: () =>
    Effect.succeed({
      ok: true,
      report: { findings: [] },
      attempts: 1,
      stdout: `<reviewer-output>{"findings":[]}</reviewer-output>`,
    }),
};

it.effect("preserves missing and inactive Task Review outcomes through submission", () =>
  Effect.gen(function* () {
    const taskId = publicTaskId("BY-1");
    const reviewerProfile = {
      agentProfile: "review",
      scope: "global" as const,
      profile: { agentRuntime: "pi" as const, runtimeConfig: { model: "test-model" } },
    };
    const reviewerPolicy = {
      profile: reviewerProfile,
      builtInInstructions: taskReviewBuiltInInstructions,
      guidance: null,
    };
    const review: TaskReviewRecord = {
      id: 1,
      taskId,
      proposal: { title: "Review me", description: "Exact", dependencyIds: [] },
      dependencyEvidence: [],
      baseRef: "refs/heads/main",
      baseCommit: "a".repeat(40),
      workspacePath: "/tmp/review-1",
      state: "running",
      outcome: null,
      workspaceCleanup: "not_created",
      cleanupBlockingReason: null,
      toolingFailure: null,
      findings: [],
    };
    const submit = (completion: "missing" | "inactive") => {
      const unused = () => Effect.die("Unexpected persistence operation");
      const persistence: TaskReviewPersistence = {
        getCompletedSimplificationAdvice: () => Effect.succeed(undefined),
        recordSimplificationAdviceFailure: () => Effect.void,
        linkSimplificationAdviceInvocation: defaultAgentLink,
        settleSimplificationAdvice: () => () => Effect.void,
        reuseJudgment: () => Effect.succeed(undefined),
        checkAdmission: () => Effect.succeed(undefined),
        admit: () =>
          Effect.succeed({
            ok: true as const,
            review,
            policy: reviewerPolicy,
            proposal: review.proposal,
            dependencyEvidence: [],
          }),
        recordCleanup: () => Effect.void,
        complete: () =>
          Effect.succeed(
            completion === "missing"
              ? { ok: false as const, code: "task_review_not_found" as const }
              : { ok: false as const, code: "task_review_not_active" as const },
          ),
        abandon: unused,
        getById: () => Effect.succeed(completion === "missing" ? undefined : review),
        getLatestForTask: unused,
        listForTask: () => Effect.succeed([]),
        getReviewerAgentSession: () => Effect.succeed(undefined),
        getReviewerConfiguration: () => Effect.succeed(undefined),
        linkAgentInvocation: defaultAgentLink,
        settleAgentReview: () => () => Effect.void,
        recordActiveFailure: unused,
        proposalIsCurrent: unused,
      };
      const reviews = openTaskReviewUseCases({
        repositoryRoot: createTestWorkspace(),
        repositoryCommonDirectory: createTestWorkspace(),
        loadRepoConfig: () => ({ ok: true, config: { idPrefix: "BY" } }),
        resolvePolicy: () => ({
          ok: true as const,
          policy: { snapshot: reviewerPolicy, profile: reviewerProfile },
        }),
        resolveSimplificationAdvicePolicy: () => ({
          ok: false as const,
          message: "must not resolve",
        }),
        persistence,
        agentSessionStorageRoot: createTestWorkspace(),
        agentPersistence: defaultAgentPersistence(),
        underengineerRuntime: {
          review: () => Effect.die("must not review"),
        },
        reviewerRuntime: passingReviewer,
        reviewerExecutor: { execute: () => Effect.die("unused") },
        readReviewBase: () =>
          Effect.succeed({
            ok: true as const,
            base: { ref: "refs/heads/main", commit: "a".repeat(40) },
          }),
        verifyReviewBase: () => Effect.succeed({ ok: true as const }),
        runWorkspace: (workspaceInput) =>
          workspaceInput.runInWorkspace === undefined
            ? Effect.succeed({ ok: true as const })
            : workspaceInput
                .runInWorkspace({
                  commandExecutor: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
                  worktreePath: "/tmp/review-1",
                })
                .pipe(Effect.map((workspaceResult) => ({ ok: true as const, workspaceResult }))),
        restoreWorkspace: () => Effect.void,
        cleanupWorkspace: () => Effect.succeed({ workspace: "removed" as const }),
        inspectWorkspace: () => Effect.succeed({ state: "absent" as const }),
      });
      return reviews.submit(taskId, "2026-08-11T12:05:00.000Z");
    };

    expect(yield* submit("missing")).toEqual({
      ok: false,
      code: "task_review_not_found",
    });
    expect(yield* submit("inactive")).toEqual({
      ok: false,
      code: "task_review_recovery_required",
      review,
    });
  }),
);

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
      const base = yield* readCurrentWorktreeReviewBase(root);
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      writeFileSync(join(root, "advance.txt"), "advance\n");
      expect(runTestProcess("git", ["add", "advance.txt"], { cwd: root }).status).toBe(0);
      expect(runTestProcess("git", ["commit", "-m", "Advance main"], { cwd: root }).status).toBe(0);
      expect(yield* verifyRecordedTaskReviewBase(root, base.base)).toEqual({ ok: true });
      expect(
        yield* verifyRecordedTaskReviewBase(root, {
          ...base.base,
          ref: "refs/heads/not-current",
        }),
      ).toEqual({ ok: true });
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

    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", "1"]);

    expect(shown.status).toBe(1);
    expect(JSON.parse(shown.stdout)).toEqual({
      error: {
        code: "not_initialized",
        message: "This workspace is not initialized for But Why?.",
      },
      help: ["Run `by init --id-prefix BY` in the repository root."],
    });
  }),
);

it.effect("rejects a missing required default Agent Profile before Task Review admission", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
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
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        idPrefix: "BY",
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
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    mkdirSync(join(root, ".but-why", "reviewers", "task"), { recursive: true });
    writeFileSync(join(root, ".but-why", "reviewers", "task", "guidance.md"), "Guidance\n");
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        idPrefix: "BY",
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
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
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

it.effect("captures and executes the effective Review Base Task Review policy", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    mkdirSync(join(root, ".but-why", "reviewers"), { recursive: true });
    writeFileSync(join(root, ".but-why", "reviewers", "task.md"), "Repository guidance\n");
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        idPrefix: "BY",
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
              skills: ["npm:@acme/task-review-skill"],
            },
          },
        },
      }),
    );
    expect(
      runTestProcess("git", ["add", ".but-why/config.json", ".but-why/reviewers/task.md"], {
        cwd: root,
      }).status,
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
    let observed: Parameters<ReviewerAgentRuntime<TaskReviewerOutput>["review"]>[0] | undefined;
    const progress: string[] = [];
    const reviewer: ReviewerAgentRuntime<TaskReviewerOutput> = {
      review: (input) => {
        observed = input;
        return passingReviewer.review(input);
      },
    };

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: reviewer,
      writeStderr: (message) => progress.push(message),
    });

    expect(submitted.status, submitted.stdout).toBe(0);
    expect(progress).toEqual([
      "Repository Preparation started\n",
      expect.stringMatching(/^Repository Preparation passed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
      "Underengineer started: profile=default model=provider/default thinking=default\n",
      expect.stringMatching(/^Underengineer failed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
      "Task Review started: profile=task-review model=provider/repo-model thinking=high\n",
      expect.stringMatching(/^Task Review passed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
    ]);
    expect(observed).toMatchObject({
      profile: {
        agentProfile: "task-review",
        scope: "repo",
        profile: {
          runtimeConfig: {
            model: "provider/repo-model",
            skills: ["npm:@acme/task-review-skill"],
          },
        },
      },
    });
    expect(observed?.systemPrompt).toContain("Repository guidance");
    const submittedOutput = JSON.parse(submitted.stdout) as { review: { id: number } };
    expect(submittedOutput).toMatchObject({
      review: { outcome: "passed" },
      task: { id: "BY-1", state: "todo" },
    });
    const shown = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      String(submittedOutput.review.id),
    ]);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: {
        reviewerConfiguration: {
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
      taskReviewerAgentRuntime: {
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
    const blockedOutput = JSON.parse(blocked.stdout) as {
      error: { code: string; review: { id: number } };
    };
    expect(blockedOutput).toMatchObject({
      error: { code: "task_review_findings" },
    });
    const blockedReview = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      String(blockedOutput.error.review.id),
    ]);
    expect(
      (JSON.parse(blockedReview.stdout) as { review: { findings: unknown } }).review.findings,
    ).toEqual([
      {
        title: "Intent gap",
        description: "The proposal omits one required outcome.",
        evidence: "The proposal text has no required outcome.",
        files: [],
      },
    ]);
    expect(blockedProgress.at(-1)).toMatch(/^Task Review failed in \d+(?:h\d+)?(?:m\d+)?s\n$/);
  }),
);

it.effect("reviews an unchanged New proposal again after a Finding-blocked Review", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
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
    writeFileSync(proposalPath, "Unchanged proposal");
    yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Review again",
      "--file",
      proposalPath,
    ]);
    const observed: Parameters<ReviewerAgentRuntime<TaskReviewerOutput>["review"]>[0][] = [];
    const finding = {
      title: "Retained gap",
      description: "The unchanged proposal retains the gap.",
      evidence: "The proposal still has the same text.",
      files: [],
    };
    const reviewer: ReviewerAgentRuntime<TaskReviewerOutput> = {
      review: (input) => {
        observed.push(input);
        const sessionReference = input.resumeSession ?? "task-session-1";
        const findings = observed.length === 1 ? [finding] : [];
        return Effect.succeed({
          ok: true as const,
          report: { findings },
          attempts: 1,
          stdout: `<reviewer-output>${JSON.stringify({ findings })}</reviewer-output>`,
          sessionReference,
        });
      },
    };

    const first = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: reviewer,
    });
    expect(first.status, first.stdout).toBe(1);
    const firstOutput = JSON.parse(first.stdout) as {
      error: { review: { id: number } };
    };

    const second = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: reviewer,
    });
    expect(second.status, second.stdout).toBe(0);
    const secondOutput = JSON.parse(second.stdout) as {
      review: { id: number; state: string; outcome: string };
    };
    expect(secondOutput).toMatchObject({
      review: { state: "complete", outcome: "passed" },
      task: { id: "BY-1", state: "todo" },
    });
    expect(secondOutput.review.id).not.toBe(firstOutput.error.review.id);
    expect(observed).toHaveLength(2);
    expect(observed[1]?.resumeSession).toBeUndefined();

    const ordinary = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: reviewer,
    });
    expect(ordinary.status, ordinary.stdout).toBe(1);
    expect(JSON.parse(ordinary.stdout)).toMatchObject({
      error: {
        code: "invalid_task_state",
        taskId: "BY-1",
        state: "todo",
      },
    });
    expect(observed).toHaveLength(2);
  }),
);

it.effect("submits one exact Task proposal through a fresh exact Review Base workspace", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
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

    let reviewerCommandCwd: string | undefined;
    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: {
        review: (input) => {
          reviewerCommandCwd = input.commandCwd;
          return passingReviewer.review(input);
        },
      },
      writeStderr: () => {
        throw new Error("stderr unavailable");
      },
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    const output = JSON.parse(submitted.stdout) as { review: { id: number } };
    expect(output).toMatchObject({
      review: { id: output.review.id, state: "complete", outcome: "passed" },
      task: { id: "BY-1", state: "todo" },
      help: ["Run `by task show BY-1` to inspect its startability and next action."],
      simplificationAdvice: { state: "unavailable" },
    });
    const shown = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      String(output.review.id),
    ]);
    const shownOutput = JSON.parse(shown.stdout) as {
      review: {
        proposalCurrent: boolean;
        workspace: { path: string; cleanup: string; blockingReason: string | null };
      };
    };
    const expectedWorkspacePath = expectedTaskReviewWorkspacePath(
      join(root, ".git"),
      output.review.id,
    );
    expect(reviewerCommandCwd).toBe(expectedWorkspacePath);
    expect(shownOutput.review.proposalCurrent).toBe(true);
    expect(shownOutput.review.workspace).toEqual({
      path: expectedWorkspacePath,
      cleanup: "removed",
      blockingReason: null,
    });
    expect(existsSync(expectedWorkspacePath)).toBe(false);
    const task = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
    expect(JSON.parse(task.stdout)).toMatchObject({ task: { state: "todo" } });
  }),
);

it.effect(
  "continues a compatible Task Agent Session with the complete current proposal and exposes transcripts",
  () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const globalConfigPath = join(root, "global.json");
      yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
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

      const observed: Parameters<ReviewerAgentRuntime<TaskReviewerOutput>["review"]>[0][] = [];
      const finding = {
        title: "Proposal needs revision",
        description: "Revise the proposal before Task Submission.",
        evidence: "The reviewer requested a revision.",
        files: [],
      };
      const reviewer: ReviewerAgentRuntime<TaskReviewerOutput> = {
        review: (input) => {
          observed.push(input);
          const storageRoot = input.sessionStorageRoot;
          if (storageRoot === undefined) throw new Error("Expected Task Agent Session storage");
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
        taskReviewerAgentRuntime: reviewer,
      });
      expect(first.status, first.stdout).toBe(1);
      const firstId = (JSON.parse(first.stdout) as { error: { review: { id: number } } }).error
        .review.id;

      const repoConfigPath = join(root, ".but-why", "config.json");
      const repoConfig = readFileSync(repoConfigPath, "utf8");
      writeFileSync(repoConfigPath, "{");
      writeFileSync(globalConfigPath, "{");
      const reused = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
        globalConfigPath,
        taskReviewerAgentRuntime: reviewer,
      });
      expect(reused.status, reused.stdout).toBe(1);
      expect(JSON.parse(reused.stdout)).toMatchObject({
        error: { code: "invalid_repo_config" },
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
        taskReviewerAgentRuntime: reviewer,
      });
      expect(second.status, second.stdout).toBe(1);
      expect(observed).toHaveLength(2);
      expect(observed[1]?.resumeSession).toBe("by-agent-2");
      expect(observed[0]?.prompt).toContain(
        '"title":"Review continuity","description":"Initial proposal","dependencyIds":[]',
      );
      expect(observed[1]?.systemPrompt).toBe(observed[0]?.systemPrompt);
      expect(observed[1]?.prompt).toContain(
        '"title":"Review continuity","description":"Changed proposal\\n","dependencyIds":[]',
      );
      expect(observed[1]?.prompt).toContain(
        'Captured direct Task Dependency evidence:\n{"dependencies":[]}',
      );
      expect(observed[1]?.prompt).not.toContain("Deterministic proposal diff");
      expect(observed[1]?.prompt).not.toContain("Initial proposal");

      const secondId = (JSON.parse(second.stdout) as { error: { review: { id: number } } }).error
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
            agentInvocationCount: 1,
            nextActions: [`Run \`by task-review show ${firstId}\` to inspect this Review.`],
          },
          {
            id: secondId,
            state: "complete",
            outcome: "blocked",
            findingCount: 1,
            toolingFailure: null,
            workspaceCleanup: "removed",
            agentInvocationCount: 1,
            nextActions: [`Run \`by task-review show ${secondId}\` to inspect this Review.`],
          },
        ],
        help: ["Run `by task-review show <review-id>` to inspect one Review."],
      });
      const shown = yield* runByInProcessEffect(root, ["task-review", "show", String(secondId)]);
      expect(shown.status, shown.stdout).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        review: {
          proposal: { description: "Changed proposal\n" },
          agentSession: {
            id: expect.any(Number),
            invocations: [{ settlementKind: "returned" }],
          },
        },
      });

      const nextDrafted = yield* runByInProcessEffect(root, ["task", "context", "draft", "BY-1"]);
      const nextDraftPath = (JSON.parse(nextDrafted.stdout) as { draft: { path: string } }).draft
        .path;
      writeFileSync(nextDraftPath, "Another changed proposal\n");
      expect((yield* runByInProcessEffect(root, ["task", "context", "apply", "BY-1"])).status).toBe(
        0,
      );
      const next = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
        globalConfigPath,
        taskReviewerAgentRuntime: reviewer,
      });
      expect(next.status).toBe(1);
      expect(JSON.parse(next.stdout)).toMatchObject({
        error: {
          review: {
            state: "complete",
            outcome: "blocked",
          },
        },
      });
    }),
  30_000,
);
