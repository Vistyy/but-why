import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { piReviewerProcessExecutor } from "../../src/agent/adapters/piReviewerProcessExecutor.js";
import type { ResolvedReviewerPiAgentProfile } from "../../src/agent/agentProfiles.js";
import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import {
  cleanupExactDisposableWorkspace,
  inspectDisposableWorktree,
} from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { runDisposableExactCommitWorkspace } from "../../src/disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteAgentSessionPersistence } from "../../src/sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import {
  readCurrentWorktreeReviewBase,
  verifyRecordedTaskReviewBase,
} from "../../src/task/review/adapters/taskReviewGit.js";
import { openTaskReviewUseCases } from "../../src/task/review/taskReviewUseCases.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  repoRoot,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

const now = "2026-08-15T12:00:00.000Z";

it.effect("submits through the supported Task Review operation with a real Agent Session", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    expect(initialized.status, initialized.stdout).toBe(0);
    commitButWhyConfigAndRecordDefault(root);
    const baseCommit = runTestProcess("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
    expect(baseCommit).toMatch(/^[0-9a-f]{40}$/u);

    const loaded = openRepositoryRuntime(root);
    if (!loaded.ok) throw new Error(`Could not open repository: ${loaded.error.code}`);
    const profile: ResolvedReviewerPiAgentProfile = {
      agentProfile: "review",
      scope: "global",
      profile: {
        agentRuntime: "pi",
        runtimeConfig: {
          model: "but-why-test/deterministic-reviewer",
          thinking: "off",
          extensions: [join(repoRoot, "test/fixtures/pi/deterministic-provider.mjs")],
        },
      },
    };
    const policy = {
      profile: {
        agentProfile: profile.agentProfile,
        scope: profile.scope,
        profile: profile.profile,
      },
      builtInInstructions: taskReviewBuiltInInstructions,
      guidance: null,
    };
    const sessionStorageRoot = join(
      loaded.runtime.context.paths.operationalDir,
      "task-review-sessions",
    );

    const submitted = yield* loaded.runtime.provide(
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence();
        const reviews = yield* openSqliteTaskReviewPersistence();
        const agents = yield* openSqliteAgentSessionPersistence();
        const created = yield* tasks.createTask({
          title: "Real Agent Session sentinel",
          description: "Exercise the supported Task Review submission boundary.",
          now,
        });
        expect(created).toMatchObject({ ok: true, task: { id: "BY-1", state: "new" } });
        if (!created.ok) return undefined;

        const useCases = openTaskReviewUseCases({
          repositoryRoot: root,
          repositoryCommonDirectory: loaded.runtime.context.commonDirectory,
          loadRepoConfig: () => ({ ok: true as const, config: { idPrefix: "BY" } }),
          resolvePolicy: () => ({
            ok: true as const,
            policy: { profile, snapshot: policy },
          }),
          persistence: reviews,
          agentSessionStorageRoot: sessionStorageRoot,
          agentPersistence: agents,
          reviewerRuntime: piReviewerAgentRuntime,
          reviewerExecutor: piReviewerProcessExecutor,
          readReviewBase: (repositoryRoot) => readCurrentWorktreeReviewBase(repositoryRoot),
          verifyReviewBase: (repositoryRoot, base) =>
            verifyRecordedTaskReviewBase(repositoryRoot, base),
          runWorkspace: (input) => runDisposableExactCommitWorkspace(input),
          cleanupWorkspace: (repositoryRoot, repositoryCommonDirectory, cleanup) =>
            cleanupExactDisposableWorkspace(repositoryRoot, repositoryCommonDirectory, cleanup),
          inspectWorkspace: (repositoryRoot, repositoryCommonDirectory, workspaceId, commitSha) =>
            inspectDisposableWorktree(
              repositoryRoot,
              repositoryCommonDirectory,
              workspaceId,
              commitSha,
            ),
        });
        return yield* useCases.submit(publicTaskId("BY-1"), now);
      }),
    );

    expect(submitted).toMatchObject({
      ok: true,
      outcome: "passed",
      review: {
        state: "complete",
        findings: [],
        agentInvocations: [
          {
            settlementKind: "returned",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            continuation: { transcriptPath: expect.any(String) },
          },
        ],
      },
    });
    if (submitted === undefined || !submitted.ok) return;

    const shown = yield* runByInProcessEffect(root, [
      "task",
      "review",
      "show",
      String(submitted.review.id),
    ]);
    expect(shown.status, shown.stdout).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: {
        state: "complete",
        outcome: "passed",
        agentSession: {
          id: expect.any(Number),
          invocations: [
            {
              id: expect.any(Number),
              continuationId: expect.any(Number),
              createdAt: expect.any(String),
              settledAt: expect.any(String),
              settlementKind: "returned",
              usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, total: 2 },
              continuation: {
                id: expect.any(Number),
                agentSessionId: expect.any(Number),
                harness: "pi",
                provider: null,
                model: "but-why-test/deterministic-reviewer",
                thinking: "off",
                transcriptPath: expect.any(String),
                unusableReason: null,
              },
            },
          ],
        },
      },
    });
  }),
);
