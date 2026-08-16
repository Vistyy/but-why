import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { AgentSessionPersistence } from "../../src/agent/agentSession/agentSession.js";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import { expectedDisposableWorkspacePath } from "../../src/disposableWorkspace/disposableWorkspacePath.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import {
  readCanonicalMainReviewBase,
  verifyRecordedTaskReviewBase,
} from "../../src/task/review/adapters/taskReviewGit.js";
import type { TaskReviewRecord } from "../../src/task/review/taskReview.js";
import type { TaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";
import type { TaskReviewPersistence } from "../../src/task/review/taskReviewPersistence.js";
import { openTaskReviewUseCases } from "../../src/task/review/taskReviewUseCases.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";
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
      outcome: "passed",
      workspaceCleanup: "removed",
      toolingFailure: null,
      abandonReason: null,
      findings: [],
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
      linkAgentInvocation: defaultAgentLink,
      settleAgentReview: () => () => Effect.void,
      recordActiveFailure: unused,
      proposalIsCurrent: unused,
    };
    const reviews = openTaskReviewUseCases({
      mainCheckoutRoot: createTestWorkspace(),
      loadRepoConfig: () => {
        calls.repoConfig += 1;
        return { ok: true, config: { idPrefix: "BY" } };
      },
      resolvePolicy: () => {
        calls.policy += 1;
        return { ok: false, message: "must not resolve" };
      },
      persistence,
      reviewerSessionStorageRoot: createTestWorkspace(),
      agentPersistence: defaultAgentPersistence(),
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
      outcome: "passed",
      review: {
        id: "review-reused",
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

it.effect("inspects and abandons only one exact Active Task Review workspace", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
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
              const repository = yield* RepositorySql;
              yield* repository.transactionImmediate("seed legacy Task Reviewer Session", (sql) =>
                sql`
                  INSERT INTO task_reviewer_sessions (task_id, fingerprint, session_reference)
                  VALUES (1, 'legacy-fingerprint', 'legacy-session')
                `.pipe(Effect.asVoid),
              );
              yield* repository.transactionImmediate("seed legacy Task Review evidence", (sql) =>
                sql`
                  UPDATE task_reviews
                  SET tooling_failure = ${JSON.stringify({
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
                  })}
                  WHERE id = ${reviewId}
                `.pipe(Effect.asVoid),
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
          message: "Task Review execution persistence failed twice.",
        },
        legacyReviewerEvidence: {
          classification: "legacy",
          legacyTaskReviewerSession: {
            fingerprint: "legacy-fingerprint",
            sessionReference: "legacy-session",
          },
          pendingExecutions: [{ sessionReference: "session-1" }],
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
        sessions: [],
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
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    mkdirSync(join(root, ".but-why", "reviewers"), { recursive: true });
    mkdirSync(join(root, "skills", "task"), { recursive: true });
    writeFileSync(join(root, ".but-why", "reviewers", "task.md"), "Repository guidance\n");
    writeFileSync(join(root, "skills", "task", "SKILL.md"), "Task skill\n");
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
      "Task Review started: profile=task-review model=provider/repo-model thinking=high\n",
      expect.stringMatching(/^Task Review passed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
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
    expect(observed?.prompt).toContain(
      "Each Finding must include exactly title, description, evidence, and files.",
    );
    expect(observed?.prompt).not.toContain("artifactRefs");
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
      error: { code: string; review: { id: string } };
    };
    expect(blockedOutput).toMatchObject({
      error: { code: "task_review_findings" },
    });
    const blockedReview = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      blockedOutput.error.review.id,
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
      error: { review: { id: string } };
    };

    const second = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: reviewer,
    });
    expect(second.status, second.stdout).toBe(0);
    const secondOutput = JSON.parse(second.stdout) as {
      review: { id: string; state: string; outcome: string };
    };
    expect(secondOutput).toMatchObject({
      review: { state: "complete", outcome: "passed" },
      task: { id: "BY-1", state: "todo" },
    });
    expect(secondOutput.review.id).not.toBe(firstOutput.error.review.id);
    expect(observed).toHaveLength(2);
    expect(observed[1]?.resumeSession).toBeUndefined();
    expect(observed[1]?.prompt).toContain("Exact Task proposal:");

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

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: passingReviewer,
      writeStderr: () => {
        throw new Error("stderr unavailable");
      },
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    const output = JSON.parse(submitted.stdout) as { review: { id: string } };
    expect(output).toEqual({
      review: { id: output.review.id, state: "complete", outcome: "passed" },
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
        taskReviewerAgentRuntime: reviewer,
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
      expect(observed[1]?.resumeSession).toBe("by-agent-1");
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
            agentInvocationCount: 1,
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
            agentInvocationCount: 1,
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
          agentSession: {
            id: expect.any(Number),
            invocations: [{ settlementKind: "returned" }],
          },
          legacyReviewerEvidence: {
            classification: "legacy",
            sessions: [],
            transcripts: [],
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
);
