import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { repoStateLoadError, runtimeError, success, usageError } from "../src/cliResults.js";
import { decodeReviewerOutputContract } from "../src/contracts/reviewerOutput.js";
import type { GitHubPrTarget } from "../src/validationRun/validationRun.js";
import { openSqliteValidationRunStore } from "../src/sqlite/sqliteValidationRunStore.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { openSqliteValidationRuns } from "../src/sqlite/sqliteValidationRuns.js";
import { openSubmitPreflight } from "../src/submit/submitPreflight.js";
import type { SubmissionEnvironment } from "../src/submissionEnvironment/submissionEnvironment.js";
import type { TaskAuthority } from "../src/taskAuthority/taskAuthority.js";
import {
  MissingAgentModel,
  MissingAgentProfile,
  UnsupportedAgentRuntime,
} from "../src/agent/agentProfileErrors.js";
import {
  GlobalConfigValidationFailed,
  InvalidReviewerConfig,
  RepoConfigValidationFailed,
  type SubmitRejectionError,
} from "../src/submit/submitRejectionErrors.js";
import {
  AgentHarnessLaunchFailed,
  CheckCommandExecutionToolingFailed,
  GitHubPollingToolingFailed,
  GitHubPublishingToolingFailed,
  GitToolingFailed,
  InfrastructureToolingFailed,
  ReviewerOutputContractFailed,
  SandcastleToolingFailed,
  SandboxingUnavailable,
  TaskContextSnapshotFailed,
  TokenUsageContractFailed,
  ValidationWorkspaceSetupFailed,
  validationToolingFailureKind,
  type ValidationToolingFailure,
} from "../src/validation/validationToolingFailures.js";
import { unsupportedValidationRuns } from "../src/validation/validationRuns.js";
import { loadLocalSubmitPreflight } from "../src/localSubmit/submitPreflight.js";
import { publicTaskId } from "../src/task/taskId.js";
import { cleanupTempRoots, createGitRepo, runByInProcess } from "./support/by-cli.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const firstTaskValidationRunId = "by-1-09224d806043.v1";

const prTarget: GitHubPrTarget = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
  remoteUrl: "https://github.com/acme/widgets.git",
};

afterEach(cleanupTempRoots);

describe("module seams", () => {
  it("constructs shared CLI result objects without serialization concerns", () => {
    expect(success({ ok: true })).toEqual({
      exitCode: 0,
      stdout: { ok: true },
    });
    expect(
      usageError({ code: "bad_args", message: "Bad arguments.", help: ["Fix the command."] }),
    ).toEqual({
      exitCode: 2,
      stdout: {
        error: { code: "bad_args", message: "Bad arguments." },
        help: ["Fix the command."],
      },
    });
    expect(
      runtimeError({ code: "failed", message: "Command failed.", help: ["Try again."] }),
    ).toEqual({
      exitCode: 1,
      stdout: {
        error: { code: "failed", message: "Command failed." },
        help: ["Try again."],
      },
    });
    expect(repoStateLoadError({ code: "state_store_unavailable", taskPrefix: "BY" })).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "state_store_unavailable",
          message: "Shared But Why? state is unavailable.",
        },
        help: [
          "Restore <git-common-dir>/but-why/state.sqlite, then run `by init --task-prefix BY`.",
        ],
      },
    });
  });

  it("exposes the typed validation error taxonomy", () => {
    const submitRejections = [
      new RepoConfigValidationFailed({
        path: ".but-why/config.json",
        diagnostics: [],
        message: "Invalid repo config.",
      }),
      new GlobalConfigValidationFailed({ diagnostics: [], message: "Invalid global config." }),
      new MissingAgentProfile({ profileName: "intent", selection: "explicit" }),
      new UnsupportedAgentRuntime({ profileName: "quality", agentRuntime: "unknown" }),
      new MissingAgentModel({ profileName: "quality", agentRuntime: "pi" }),
      new InvalidReviewerConfig({ profileName: "quality", message: "Invalid reviewer config." }),
    ] satisfies readonly SubmitRejectionError[];
    const toolingFailures = [
      new TaskContextSnapshotFailed({
        operationName: "save_task_context_snapshot",
        message: "snapshot failed",
      }),
      new ValidationWorkspaceSetupFailed({
        operationName: "copy_allowlisted_file",
        tempRefName: firstTaskValidationRunId,
        submittedSha: "abc123",
        errorMessage: "Missing allowlisted file.",
        cleanupResult: { worktree: "not_created", tempRef: "removed" },
      }),
      new InfrastructureToolingFailed({
        operationName: "prepare_validation_infrastructure",
        message: "Temp directory failed.",
      }),
      new GitToolingFailed({ operationName: "create_temp_ref", message: "git failed" }),
      new SandcastleToolingFailed({
        operationName: "create_workspace",
        message: "sandcastle failed",
      }),
      new AgentHarnessLaunchFailed({
        operationName: "launch_agent_harness",
        profileName: "review",
        agentRuntime: "pi",
        message: "launch failed",
      }),
      new SandboxingUnavailable({
        operationName: "create_sandbox",
        message: "Sandbox runtime is unavailable.",
      }),
      new CheckCommandExecutionToolingFailed({
        operationName: "run_check_command",
        command: "just test",
        message: "spawn failed",
      }),
      new ReviewerOutputContractFailed({
        operationName: "intent_review",
        reviewer: "intent",
        attempts: 3,
        diagnostics: [],
        message: "bad output",
      }),
      new TokenUsageContractFailed({
        operationName: "record_token_usage",
        diagnostics: [],
        message: "bad token usage",
      }),
      new GitHubPublishingToolingFailed({ operationName: "publish_pr", message: "gh failed" }),
      new GitHubPollingToolingFailed({ operationName: "watch_pr", message: "gh failed" }),
    ] satisfies readonly ValidationToolingFailure[];

    expect(submitRejections.map((error) => error._tag)).toEqual([
      "RepoConfigValidationFailed",
      "GlobalConfigValidationFailed",
      "MissingAgentProfile",
      "UnsupportedAgentRuntime",
      "MissingAgentModel",
      "InvalidReviewerConfig",
    ]);
    expect(toolingFailures.map(validationToolingFailureKind)).toEqual([
      "task_context_snapshot_failed",
      "validation_workspace_setup_failed",
      "infrastructure_tooling_failed",
      "git_tooling_failed",
      "sandcastle_tooling_failed",
      "agent_harness_launch_failed",
      "sandboxing_unavailable",
      "check_command_execution_tooling_failed",
      "reviewer_output_contract_failed",
      "token_usage_contract_failed",
      "github_publishing_tooling_failed",
      "github_polling_tooling_failed",
    ]);
  });

  it("starts local validation through the ValidationRuns seam", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const validationRunStore = sqliteValidationRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Submit through state",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true, changed: true });

    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({
      ok: true,
      validationRunId: firstTaskValidationRunId,
      taskState: "validating",
      previousTaskState: "implementing",
    });
    expect(taskStore.getTaskById(taskId)).toMatchObject({
      id: "BY-1",
      state: "validating",
      branch: "feature/by-1",
      updatedAt: thirdNow,
    });
    expect(validationRunStore.getLatestValidationRunIdForTask(taskId)).toBe(
      firstTaskValidationRunId,
    );

    expect(
      taskStore.transitionTaskState({ taskId, to: "needs_input", now: thirdNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "def456",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_HAS_ACTIVE_VALIDATION_RUN" });
    expect(taskStore.getTaskById(taskId)).toMatchObject({
      state: "needs_input",
      branch: "feature/by-1",
    });
    expect(validationRunStore.getLatestValidationRunIdForTask(taskId)).toBe(
      firstTaskValidationRunId,
    );
  });

  it("saves an immutable Task Context Snapshot through the ValidationRuns seam", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const validationRunStore = sqliteValidationRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Snapshot intent",
      description: "Judge this intent",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);
    const snapshot = {
      version: 1 as const,
      title: "Snapshot intent",
      description: "Judge this intent",
      comments: ["First comment", "Second comment"],
    };

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validationRuns.saveTaskContextSnapshot({
        validationRunId: firstTaskValidationRunId,
        snapshot,
        now: thirdNow,
      }),
    ).toEqual({ ok: true });
    expect(
      validationRuns.saveTaskContextSnapshot({
        validationRunId: firstTaskValidationRunId,
        snapshot,
        now: thirdNow,
      }),
    ).toEqual({ ok: true });
    expect(
      validationRuns.saveTaskContextSnapshot({
        validationRunId: firstTaskValidationRunId,
        snapshot: { ...snapshot, comments: ["Replacement"] },
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_CONTEXT_SNAPSHOT_REPLACEMENT_REJECTED" });
    expect(validationRunStore.getTaskContextSnapshot(firstTaskValidationRunId)).toEqual(snapshot);
  });

  it("records typed tooling failures without moving the Task to needs_input", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const validationRunStore = sqliteValidationRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Record typed tooling failure",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);
    const failure = new ValidationWorkspaceSetupFailed({
      operationName: "copy_allowlisted_file",
      tempRefName: `refs/but-why/validation-runs/${firstTaskValidationRunId}/validation`,
      submittedSha: "abc123",
      worktreePath: "/tmp/but-why-worktree",
      errorMessage: "Allowlisted validation workspace file is missing: .env.test",
      cleanupResult: {
        worktree: "not_created",
        tempRef: "removed",
      },
    });

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validationRuns.recordToolingFailure({
        validationRunId: firstTaskValidationRunId,
        toolingFailure: failure,
        taskRecoveryState: "implementing",
        now: thirdNow,
      }),
    ).toEqual({ ok: true });
    const sandboxFailure = new SandboxingUnavailable({
      operationName: "create_sandbox",
      message: "Sandbox runtime is unavailable.",
    });

    expect(
      validationRuns.recordToolingFailure({
        validationRunId: firstTaskValidationRunId,
        toolingFailure: sandboxFailure,
        taskRecoveryState: "implementing",
        now: thirdNow,
      }),
    ).toEqual({ ok: true });
    const toolingErrors =
      validationRunStore.listValidationRunToolingErrors(firstTaskValidationRunId);

    expect(toolingErrors).toEqual([
      expect.objectContaining({
        errorKind: "validation_workspace_setup_failed",
        operationName: "copy_allowlisted_file",
      }),
      expect.objectContaining({
        errorKind: "sandboxing_unavailable",
        operationName: "create_sandbox",
      }),
    ]);
    expect(toolingErrors[1]).not.toHaveProperty("tempRefName");
    expect(toolingErrors[1]).not.toHaveProperty("submittedSha");
    expect(toolingErrors[1]).not.toHaveProperty("cleanupWorktree");
    expect(toolingErrors[1]).not.toHaveProperty("cleanupTempRef");
    expect(taskStore.getTaskById(taskId)).toMatchObject({
      state: "implementing",
    });
  });

  it("records exhausted reviewer output as tooling failure without Findings", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const validationRunStore = sqliteValidationRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Reject malformed reviewer output",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toMatchObject({ ok: true });

    const failure = Effect.runSync(
      Effect.flip(
        decodeReviewerOutputContract({
          reviewer: "intent",
          attempts: 3,
          output: { findings: [{ title: "Malformed" }] },
        }),
      ),
    );

    expect(failure).toMatchObject({
      _tag: "ReviewerOutputContractFailed",
      reviewer: "intent",
      attempts: 3,
    });
    expect(
      validationRuns.recordToolingFailure({
        validationRunId: firstTaskValidationRunId,
        toolingFailure: failure,
        taskRecoveryState: "implementing",
        now: thirdNow,
      }),
    ).toEqual({ ok: true });
    expect(validationRunStore.listValidationRunFindings(firstTaskValidationRunId)).toEqual([]);
    expect(validationRunStore.listValidationRunToolingErrors(firstTaskValidationRunId)).toEqual([
      expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
    ]);
    expect(taskStore.getTaskById(taskId)).toMatchObject({ state: "implementing" });
  });

  it("rejects invalid local validation starts through the ValidationRuns seam", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const validationRunStore = sqliteValidationRunStore(root);
    const validationRuns = sqliteValidationRuns(root);
    const task = taskStore.createTask({
      title: "Reject invalid starts",
      description: "Description",
      now: firstNow,
    });
    const taskId = publicTaskId(task.id);

    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: secondNow,
      }),
    ).toEqual({ ok: false, code: "TASK_STATE_NOT_SUBMITTABLE", state: "todo" });
    expect(validationRunStore.getLatestValidationRunIdForTask(taskId)).toBeNull();

    expect(
      taskStore.transitionTaskState({ taskId, to: "implementing", now: secondNow }),
    ).toMatchObject({ ok: true });
    expect(
      validationRuns.start({
        taskId,
        branch: "feature/by-1",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toMatchObject({ ok: true });
    expect(
      validationRunStore.recordValidationRunError({
        validationRunId: firstTaskValidationRunId,
        now: thirdNow,
      }),
    ).toEqual({ ok: true });
    expect(
      taskStore.transitionTaskState({ taskId, to: "needs_input", now: thirdNow }),
    ).toMatchObject({ ok: true });

    expect(
      validationRuns.start({
        taskId,
        branch: "feature/other",
        commitSha: "def456",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_BRANCH_MISMATCH", boundBranch: "feature/by-1" });
    expect(validationRunStore.getLatestValidationRunIdForTask(taskId)).toBe(
      firstTaskValidationRunId,
    );
  });

  it("rejects unsupported validation starts with a structured error", () => {
    const validationRuns = unsupportedValidationRuns();

    expect(
      validationRuns.start({
        taskId: publicTaskId("REMOTE-1"),
        branch: "feature/remote",
        commitSha: "abc123",
        prTarget,
        now: thirdNow,
      }),
    ).toEqual({ ok: false, code: "TASK_AUTHORITY_UNSUPPORTED" });
  });

  it("coordinates submit through TaskAuthority and SubmissionEnvironment seams", () => {
    const taskId = publicTaskId("BY-1");
    const events: string[] = [];
    const taskAuthority: TaskAuthority = {
      taskPrefix: "BY",
      resolveTaskId: (inputTaskId) => ({ ok: true, taskId: inputTaskId }),
      recoverPendingTaskContextSnapshot: (input) => {
        events.push(`recover:${input.taskId}`);
        return { ok: true, recoveredValidationRunId: null };
      },
      getTaskSubmitReadiness: (inputTaskId) => {
        events.push(`readiness:${inputTaskId}`);
        return { ok: true, taskId: inputTaskId, previousTaskState: "implementing" };
      },
      startValidation: (input) => {
        events.push(`start:${input.branch}:${input.commitSha}`);
        return {
          ok: true,
          validationRunId: firstTaskValidationRunId,
          taskState: "validating",
          previousTaskState: "implementing",
        };
      },
      recordValidationToolingFailure: () => ({ ok: true }),
      recordPhaseStatus: () => ({ ok: true }),
      recordPrepareRound: () => ({ ok: true }),
      recordCheckRound: () => ({ ok: true }),
    };
    const submissionEnvironment: SubmissionEnvironment = {
      readSubmittedCodeCandidate: () => {
        events.push("candidate");
        return {
          ok: true,
          candidate: {
            branch: "feature/by-1",
            commitSha: "abc123",
            prTarget,
          },
        };
      },
      createValidationWorkspaceForValidationRun: () =>
        Effect.die(new Error("not used by submit preflight")),
    };

    const submitPreflight = openSubmitPreflight({ taskAuthority, submissionEnvironment });

    expect(submitPreflight.submitTask({ taskId, now: thirdNow })).toEqual({
      ok: true,
      taskId,
      validationRunId: firstTaskValidationRunId,
      branch: "feature/by-1",
      commitSha: "abc123",
      taskState: "validating",
      previousTaskState: "implementing",
      prTarget,
    });
    expect(events).toEqual([
      "recover:BY-1",
      "readiness:BY-1",
      "candidate",
      "start:feature/by-1:abc123",
    ]);
  });

  it("returns submit preflight domain rejections before Git facts are read", () => {
    const root = initializedRepo();
    const taskStore = sqliteTaskStore(root);
    const validationRunStore = sqliteValidationRunStore(root);
    const task = taskStore.createTask({
      title: "Not started",
      description: "Description",
      now: firstNow,
    });
    const submitPreflight = loadLocalSubmitPreflight(root, {
      globalConfigPath: join(root, ".test-global-config.json"),
      migrationTimestamp: () => firstNow,
    });

    if (!submitPreflight.ok) {
      throw new Error("Could not load submit preflight");
    }

    expect(
      submitPreflight.submit.submitTask({ taskId: publicTaskId(task.id), now: secondNow }),
    ).toEqual({
      ok: false,
      kind: "preflight_rejection",
      code: "TASK_STATE_NOT_SUBMITTABLE",
      taskId: "BY-1",
      state: "todo",
    });
    expect(taskStore.getTaskById(publicTaskId(task.id))).toMatchObject({
      state: "todo",
      branch: null,
    });
    expect(validationRunStore.getLatestValidationRunIdForTask(publicTaskId(task.id))).toBeNull();
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  const result = runByInProcess(root, ["init", "--task-prefix", "BY"]);

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  writeFileSync(
    join(root, ".but-why/config.json"),
    `${JSON.stringify(
      { taskPrefix: "BY", validation: { checks: [{ id: "quality", command: "true" }] } },
      null,
      2,
    )}\n`,
  );

  return root;
};

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const sqliteTaskStore = (root: string) =>
  openSqliteTaskStore({
    statePath: sharedStatePath(root),
    taskPrefix: "BY",
    migrationTimestamp: () => firstNow,
  });

const sqliteValidationRunStore = (root: string) =>
  openSqliteValidationRunStore({
    statePath: sharedStatePath(root),
    migrationTimestamp: () => firstNow,
  });

const sqliteValidationRuns = (root: string) =>
  openSqliteValidationRuns({
    statePath: sharedStatePath(root),
    migrationTimestamp: () => firstNow,
  });
