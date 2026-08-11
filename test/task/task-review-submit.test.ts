import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../src/contracts/reviewerOutput.js";
import { expectedDisposableWorkspacePath } from "../../src/disposableWorkspace/disposableWorkspacePath.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { taskReviewInstructions } from "../../src/task/review/taskReview.js";
import {
  readCanonicalMainReviewBase,
  verifyRecordedTaskReviewBase,
} from "../../src/task/review/taskReviewGit.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

const passingReviewer: ReviewerAgentRuntime<ReviewerOutput> = {
  review: () =>
    Effect.succeed({
      ok: true,
      report: { findings: [] },
      attempts: 1,
      stdout: `<reviewer-output>{"findings":[]}</reviewer-output>`,
    }),
};

it("verifies the recorded Task Review Base without requiring its branch tip to remain fixed", () => {
  const root = createGitRepo();
  expect(runTestProcess("git", ["config", "user.name", "But Why Test"], { cwd: root }).status).toBe(
    0,
  );
  expect(
    runTestProcess("git", ["config", "user.email", "but-why@example.test"], { cwd: root }).status,
  ).toBe(0);
  expect(runTestProcess("git", ["branch", "-M", "main"], { cwd: root }).status).toBe(0);
  writeFileSync(join(root, "initial.txt"), "initial\n");
  expect(runTestProcess("git", ["add", "initial.txt"], { cwd: root }).status).toBe(0);
  expect(runTestProcess("git", ["commit", "-m", "Initial"], { cwd: root }).status).toBe(0);
  const base = readCanonicalMainReviewBase(root);
  expect(base.ok).toBe(true);
  if (!base.ok) return;
  writeFileSync(join(root, "advance.txt"), "advance\n");
  expect(runTestProcess("git", ["add", "advance.txt"], { cwd: root }).status).toBe(0);
  expect(runTestProcess("git", ["commit", "-m", "Advance main"], { cwd: root }).status).toBe(0);
  expect(verifyRecordedTaskReviewBase(root, base.base)).toEqual({ ok: true });
  expect(
    verifyRecordedTaskReviewBase(root, { ...base.base, ref: "refs/heads/not-main" }),
  ).toMatchObject({ ok: false, message: expect.stringContaining("ref") });
  expect(
    verifyRecordedTaskReviewBase(root, { ...base.base, commit: "f".repeat(40) }),
  ).toMatchObject({ ok: false, message: expect.stringContaining("commit") });
});

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
            reviews.admit({
              reviewId,
              taskId: publicTaskId("BY-1"),
              policy: {
                id: "task_advisory_review",
                version: 1,
                agentProfile: "review",
                profileScope: "global",
                instructions: taskReviewInstructions,
              },
              baseRef: "refs/heads/main",
              baseCommit: commit,
              workspacePath,
              now: "2026-08-11T12:00:00.000Z",
            }),
          ),
        ),
      ),
    );

    const shown = yield* runByInProcessEffect(root, ["task", "review", "show", reviewId]);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: { id: reviewId, state: "running", workspace: { path: workspacePath } },
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
      review: { state: "complete", outcome: "tooling_failed", workspace: { cleanup: "removed" } },
    });
    expect(existsSync(workspacePath)).toBe(false);
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
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    const output: unknown = JSON.parse(submitted.stdout);
    expect(output).toMatchObject({
      review: {
        taskId: "BY-1",
        state: "complete",
        outcome: "passed",
        proposal: { title: "Review me", description: "Exact proposal", dependencyIds: [] },
        reviewBase: { ref: "refs/heads/main" },
        workspace: { cleanup: "removed" },
      },
    });
    const review = (output as { review: { workspace: { path: string } } }).review;
    expect(existsSync(review.workspace.path)).toBe(false);
  }),
);
