import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, it as ordinaryIt } from "vitest";

import { prepareStateDatabaseSession } from "../src/init/stateDatabase.js";
import { openSqliteValidationRunStore } from "../src/sqlite/sqliteValidationRunStore.js";
import { openSqliteValidationRuns } from "../src/sqlite/sqliteValidationRuns.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { loadTaskUseCases } from "../src/localTask/taskUseCases.js";
import type { TaskState } from "../src/task/lifecycle.js";
import { publicTaskId } from "../src/task/taskId.js";
import { runByInProcessEffect, runByWithEnv } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { fakeSubmitPreflight } from "./support/submitPreflight.js";
import { taskStateTransitionPath } from "./support/taskLifecycle.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const firstTaskValidationRunId = "by-1-09224d806043.v1";
const secondTaskValidationRunId = "by-1-09224d806043.v2";
const firstTaskValidationRef = `refs/but-why/validation-runs/${firstTaskValidationRunId}/validation`;

describe("by submit CLI", () => {
  it.effect(
    "creates a commit-bound active Validation Run and moves an implementing Task to validating",
    () =>
      Effect.gen(function* () {
        const root = preparedRepoOnBranch("feature/by-1", [
          "Approved first comment",
          "Approved second comment",
        ]);
        const commitSha = currentCommitSha(root);

        const branchBeforeSubmit = currentBranch(root);
        const statusBeforeSubmit = gitStatus(root);
        const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(`submission:
  taskId: BY-1
  validationRunId: ${firstTaskValidationRunId}
  branch: feature/by-1
  commitSha: ${commitSha}
  taskState: validating
  prTarget:
    owner: acme
    repo: widgets
    baseBranch: main
    remoteName: origin
    remoteUrl: "https://github.com/acme/widgets.git"
  validationWorkspace:
    tempRefName: ${firstTaskValidationRef}
    submittedSha: ${commitSha}
    worktreeHead: ${commitSha}
    cleanupResult:
      worktree: removed
      tempRef: removed`);

        expect(currentBranch(root)).toBe(branchBeforeSubmit);
        expect(currentCommitSha(root)).toBe(commitSha);
        expect(gitStatus(root)).toBe(statusBeforeSubmit);
        expect(gitRefExists(root, firstTaskValidationRef)).toBe(false);

        const validationWorkspace =
          validationRunStore(root).getValidationWorkspaceSetup(firstTaskValidationRunId);

        expect(validationWorkspace).toMatchObject({
          validationRunId: firstTaskValidationRunId,
          tempRefName: firstTaskValidationRef,
          submittedSha: commitSha,
          worktreeHead: commitSha,
          cleanupWorktree: "removed",
          cleanupTempRef: "removed",
        });
        expect(validationWorkspace).not.toHaveProperty("worktreePath");
        expect(validationRunStore(root).getTaskContextSnapshot(firstTaskValidationRunId)).toEqual({
          version: 1,
          title: "Submit task",
          description: "Description for Submit task",
          comments: ["Approved first comment", "Approved second comment"],
        });
        expect(
          taskStore(root).appendTaskComment({
            taskId: publicTaskId("BY-1"),
            content: "Later comment",
            now: () => thirdNow,
          }),
        ).toEqual({ ok: false, code: "invalid_task_state", state: "validating" });
        expect(validationRunStore(root).getTaskContextSnapshot(firstTaskValidationRunId)).toEqual({
          version: 1,
          title: "Submit task",
          description: "Description for Submit task",
          comments: ["Approved first comment", "Approved second comment"],
        });
        expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".sandcastle/worktrees/");

        expect((yield* runByInProcessEffect(root, ["task", "show", "BY-1"])).stdout).toContain(
          `state: validating\n  createdAt: "${firstNow}"\n  updatedAt: "${thirdNow}"\n  commentCount: 2`,
        );

        expect(validationRunStore(root).getValidationRunById(firstTaskValidationRunId)).toEqual({
          id: firstTaskValidationRunId,
          taskId: "BY-1",
          taskValidationNumber: 1,
          status: "active",
          branch: "feature/by-1",
          commitSha,
          githubOwner: "acme",
          githubRepo: "widgets",
          githubBaseBranch: "main",
          githubRemoteName: "origin",
          githubRemoteUrl: "https://github.com/acme/widgets.git",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        });
        expect(
          validationRunStore(root).listValidationRunPhaseStatuses(firstTaskValidationRunId),
        ).toEqual([
          {
            validationRunId: firstTaskValidationRunId,
            phase: "prepare",
            status: "skipped",
            errorMessage: "Prepare is not configured.",
            createdAt: thirdNow,
            updatedAt: thirdNow,
          },
          {
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            status: "passed",
            errorMessage: null,
            createdAt: thirdNow,
            updatedAt: thirdNow,
          },
        ]);
        expect(validationRunStore(root).listValidationRunRounds(firstTaskValidationRunId)).toEqual([
          {
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
            roundNumber: 1,
            status: "passed",
            createdAt: thirdNow,
            updatedAt: thirdNow,
          },
        ]);
        expect(
          validationRunStore(root).listValidationRunArtifacts(firstTaskValidationRunId),
        ).toEqual([
          expect.objectContaining({
            ref: `artifact:${firstTaskValidationRunId}/checks/quality/stdout.txt`,
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
          }),
          expect.objectContaining({
            ref: `artifact:${firstTaskValidationRunId}/checks/quality/stderr.txt`,
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
          }),
          expect.objectContaining({
            ref: `artifact:${firstTaskValidationRunId}/checks/quality/exit-code.json`,
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
          }),
          expect.objectContaining({
            ref: `artifact:${firstTaskValidationRunId}/checks/quality/logs.txt`,
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
          }),
        ]);
        for (const artifact of validationRunStore(root).listValidationRunArtifacts(
          firstTaskValidationRunId,
        )) {
          expect(existsSync(join(root, ".git", "but-why", "artifacts", artifact.path))).toBe(true);
        }
      }),
  );

  it.effect("records a typed tooling failure when Task Context Snapshot creation fails", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/by-1");
      const database = new DatabaseSync(sharedStatePath(root));

      database.exec(`
      CREATE TRIGGER reject_task_context_snapshot_save
      BEFORE UPDATE OF task_context_snapshot_state ON validation_runs
      WHEN NEW.task_context_snapshot_state = 'saved'
      BEGIN
        SELECT RAISE(FAIL, 'snapshot storage unavailable');
      END
    `);
      database.close();

      const result = yield* withFakeGh(() =>
        runSubmit(root, ["BY-1", "--output", "json"], thirdNow),
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "task_context_snapshot_failed",
          message: "Validation tooling failed.",
          operationName: "save_task_context_snapshot",
          errorMessage: "snapshot storage unavailable",
        },
        help: ["Fix the validation tooling problem, then rerun submit."],
      });
      expect(taskStore(root).getTaskById(publicTaskId("BY-1"))).toMatchObject({
        state: "implementing",
      });
      expect(validationRunStore(root).getValidationRunById(firstTaskValidationRunId)).toMatchObject(
        {
          status: "error",
        },
      );
      expect(validationRunStore(root).getTaskContextSnapshot(firstTaskValidationRunId)).toBeNull();
      expect(
        validationRunStore(root).listValidationRunToolingErrors(firstTaskValidationRunId),
      ).toEqual([
        expect.objectContaining({
          errorKind: "task_context_snapshot_failed",
          operationName: "save_task_context_snapshot",
          errorMessage: "snapshot storage unavailable",
        }),
      ]);
      expect(
        validationRunStore(root).getValidationWorkspaceSetup(firstTaskValidationRunId),
      ).toBeUndefined();
    }),
  );

  it.effect("recovers an interrupted pending snapshot before starting a later submit", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/by-1");
      const commitSha = currentCommitSha(root);
      const interrupted = validationRuns(root).start({
        taskId: publicTaskId("BY-1"),
        branch: "feature/by-1",
        commitSha,
        prTarget: {
          owner: "acme",
          repo: "widgets",
          baseBranch: "main",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/widgets.git",
        },
        now: secondNow,
      });

      expect(interrupted).toMatchObject({ ok: true, validationRunId: firstTaskValidationRunId });

      const result = yield* withFakeGh(() =>
        runSubmit(root, ["BY-1", "--output", "json"], thirdNow),
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        submission: { validationRunId: secondTaskValidationRunId },
      });
      expect(validationRunStore(root).getValidationRunById(firstTaskValidationRunId)).toMatchObject(
        {
          status: "error",
        },
      );
      expect(
        validationRunStore(root).listValidationRunToolingErrors(firstTaskValidationRunId),
      ).toEqual([expect.objectContaining({ errorKind: "task_context_snapshot_failed" })]);
      expect(
        validationRunStore(root).getTaskContextSnapshot(secondTaskValidationRunId),
      ).toMatchObject({
        version: 1,
        title: "Submit task",
      });
    }),
  );

  it.effect("rejects missing validation.checks before Validation Run creation", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/missing-checks");

      writeRepoConfig(root, { taskPrefix: "BY" });
      spawnGit(root, "add", ".but-why/config.json");
      spawnGit(root, "commit", "-m", "Remove check config");

      const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_repo_config");
      expect(result.stdout).toContain(
        "Repo config must define at least one validation.checks entry.",
      );
      expect(taskHasNoValidationRuns(root, "BY-1")).toBe(true);
      expect(taskState(root, "BY-1")).toBe("implementing");
    }),
  );

  it.effect("loads selected global Agent Profiles and maps invalid global config", () =>
    Effect.gen(function* () {
      const root = initializedRepo();
      const globalConfigPath = join(root, "global-config.json");

      writeRepoConfig(root, {
        taskPrefix: "BY",
        validation: { checks: [{ id: "quality", command: "true" }] },
        review: { intent: { reviewer: "intent" } },
        reviewers: {
          intent: {
            agentProfile: "default",
            instructionsFile: ".but-why/reviewers/intent.md",
          },
        },
      });
      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          agentProfiles: {
            default: { agentRuntime: "pi", agentModel: "openai-codex/gpt-5.5" },
          },
        }),
      );

      const loaded = yield* runByInProcessEffect(root, ["submit", "BY-999"], thirdNow, {
        globalConfigPath,
      });
      expect(loaded.status).toBe(1);
      expect(loaded.stdout).toContain("code: TASK_NOT_FOUND");

      writeFileSync(
        globalConfigPath,
        JSON.stringify({ agentProfiles: { default: { agentModel: "openai-codex/gpt-5.5" } } }),
      );
      const invalid = yield* runByInProcessEffect(root, ["submit", "BY-999"], thirdNow, {
        globalConfigPath,
      });
      expect(invalid.status).toBe(1);
      expect(invalid.stdout).toContain("code: invalid_global_config");
      expect(invalid.stdout).toContain("agentProfiles.default.agentRuntime");
    }),
  );

  it.effect("runs prepare before checks inside the Validation Workspace", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/prepare-passes");

      writeRepoConfig(root, {
        taskPrefix: "BY",
        prepare: { command: "printf prepared > prepared.txt" },
        validation: {
          checks: [{ id: "quality", command: 'test "$(cat prepared.txt)" = prepared' }],
        },
      });
      spawnGit(root, "add", ".but-why/config.json");
      spawnGit(root, "commit", "-m", "Configure prepare");
      const submittedSha = currentCommitSha(root);

      const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(currentCommitSha(root)).toBe(submittedSha);
      expect(existsSync(join(root, "prepared.txt"))).toBe(false);
      expect(
        validationRunStore(root).listValidationRunPhaseStatuses(firstTaskValidationRunId),
      ).toEqual([
        {
          validationRunId: firstTaskValidationRunId,
          phase: "prepare",
          status: "passed",
          errorMessage: null,
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "checks",
          status: "passed",
          errorMessage: null,
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ]);
      expect(validationRunStore(root).listValidationRunRounds(firstTaskValidationRunId)).toEqual([
        {
          validationRunId: firstTaskValidationRunId,
          phase: "prepare",
          producer: "prepare",
          roundNumber: 1,
          status: "passed",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "checks",
          producer: "quality",
          roundNumber: 1,
          status: "passed",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ]);
      const artifactRefs = [
        ...prepareArtifactRefs(firstTaskValidationRunId),
        ...checkArtifactRefs(firstTaskValidationRunId, "quality"),
      ];

      expect(
        validationRunStore(root)
          .listValidationRunArtifacts(firstTaskValidationRunId)
          .map((artifact) => artifact.ref),
      ).toEqual(artifactRefs);
    }),
  );

  it.effect("turns a failed prepare into a blocking Finding and skips checks", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/prepare-fails");

      writeRepoConfig(root, {
        taskPrefix: "BY",
        prepare: { command: 'printf out && printf err >&2 && node -e "process.exit(7)"' },
        validation: {
          checks: [{ id: "quality", command: "true" }],
        },
      });
      spawnGit(root, "add", ".but-why/config.json");
      spawnGit(root, "commit", "-m", "Configure failing prepare");

      const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: validation_findings");
      expect(taskState(root, "BY-1")).toBe("needs_input");
      expect(validationRunStore(root).getValidationRunById(firstTaskValidationRunId)).toMatchObject(
        {
          status: "failed",
        },
      );
      expect(
        validationRunStore(root).listValidationRunPhaseStatuses(firstTaskValidationRunId),
      ).toEqual([
        {
          validationRunId: firstTaskValidationRunId,
          phase: "prepare",
          status: "failed",
          errorMessage: null,
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "checks",
          status: "skipped",
          errorMessage: "Prepare did not pass.",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "acceptance_review",
          status: "skipped",
          errorMessage: "Prepare did not pass.",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "specialist_review",
          status: "skipped",
          errorMessage: "Prepare did not pass.",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "publish_pr",
          status: "skipped",
          errorMessage: "Prepare did not pass.",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
        {
          validationRunId: firstTaskValidationRunId,
          phase: "watch_pr",
          status: "skipped",
          errorMessage: "Prepare did not pass.",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ]);
      expect(validationRunStore(root).listValidationRunRounds(firstTaskValidationRunId)).toEqual([
        {
          validationRunId: firstTaskValidationRunId,
          phase: "prepare",
          producer: "prepare",
          roundNumber: 1,
          status: "failed",
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ]);

      const artifactRefs = prepareArtifactRefs(firstTaskValidationRunId);
      const findings = validationRunStore(root).listValidationRunFindings(firstTaskValidationRunId);

      expect(findings).toEqual([
        {
          id: `${firstTaskValidationRunId}-F1`,
          validationRunId: firstTaskValidationRunId,
          phase: "prepare",
          producer: "prepare",
          title: "Prepare failed",
          description: "Prepare command exited with code 7.",
          evidence:
            'command: printf out && printf err >&2 && node -e "process.exit(7)"\nexitCode: 7',
          files: [],
          artifactRefs,
          createdAt: thirdNow,
          updatedAt: thirdNow,
        },
      ]);
      expect(findings[0]).not.toHaveProperty("severity");
      expect(
        validationRunStore(root)
          .listValidationRunArtifacts(firstTaskValidationRunId)
          .map((artifact) => artifact.ref),
      ).toEqual(artifactRefs);
    }),
  );

  it.effect("turns a timed-out prepare into a blocking Finding", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/prepare-timeout");

      writeRepoConfig(root, {
        taskPrefix: "BY",
        prepare: { command: "sleep 10", timeoutSeconds: 1 },
        validation: {
          checks: [{ id: "quality", command: "true" }],
        },
      });
      spawnGit(root, "add", ".but-why/config.json");
      spawnGit(root, "commit", "-m", "Configure timed-out prepare");

      const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: validation_findings");
      expect(validationRunStore(root).listValidationRunFindings(firstTaskValidationRunId)).toEqual([
        expect.objectContaining({
          title: "Prepare timed out",
          description: "Prepare command timed out after 1 seconds.",
          artifactRefs: prepareArtifactRefs(firstTaskValidationRunId),
          files: [],
        }),
      ]);
    }),
  );

  it.effect(
    "turns a failed check into a blocking Finding and leaves the submitted branch unchanged",
    () =>
      Effect.gen(function* () {
        const root = preparedRepoOnBranch("feature/failing-check");
        const commitSha = currentCommitSha(root);

        writeRepoConfig(root, {
          taskPrefix: "BY",
          validation: { checks: [{ id: "quality", command: 'node -e "process.exit(7)"' }] },
        });
        spawnGit(root, "add", ".but-why/config.json");
        spawnGit(root, "commit", "-m", "Make validation check fail");
        const failingCommitSha = currentCommitSha(root);

        const branchBeforeSubmit = currentBranch(root);
        const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("code: validation_findings");
        expect(result.stdout).toContain("validationRunId: by-1-09224d806043.v1");
        expect(currentBranch(root)).toBe(branchBeforeSubmit);
        expect(currentCommitSha(root)).toBe(failingCommitSha);
        expect(currentCommitSha(root)).not.toBe(commitSha);
        expect(taskState(root, "BY-1")).toBe("needs_input");
        expect(
          validationRunStore(root).getValidationRunById(firstTaskValidationRunId),
        ).toMatchObject({
          status: "failed",
        });
        expect(validationRunStore(root).listValidationRunRounds(firstTaskValidationRunId)).toEqual([
          {
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
            roundNumber: 1,
            status: "failed",
            createdAt: thirdNow,
            updatedAt: thirdNow,
          },
        ]);

        const artifactRefs = checkArtifactRefs(firstTaskValidationRunId, "quality");
        const findings =
          validationRunStore(root).listValidationRunFindings(firstTaskValidationRunId);

        expect(findings).toEqual([
          {
            id: `${firstTaskValidationRunId}-F1`,
            validationRunId: firstTaskValidationRunId,
            phase: "checks",
            producer: "quality",
            title: "Check failed: quality",
            description: "Configured check quality exited with code 7.",
            evidence: 'command: node -e "process.exit(7)"\nexitCode: 7',
            files: [],
            artifactRefs,
            createdAt: thirdNow,
            updatedAt: thirdNow,
          },
        ]);
        expect(findings[0]).not.toHaveProperty("severity");
        expect(
          validationRunStore(root)
            .listValidationRunArtifacts(firstTaskValidationRunId)
            .map((artifact) => artifact.ref),
        ).toEqual(artifactRefs);
      }),
  );

  it.effect(
    "records workspace setup tooling errors on the Validation Run without sending the Task to needs_input",
    () =>
      Effect.gen(function* () {
        const root = preparedRepoOnBranch("feature/missing-copy-file");
        const commitSha = currentCommitSha(root);

        writeRepoConfig(root, {
          taskPrefix: "BY",
          validation: { checks: [{ id: "quality", command: "true" }] },
          validationWorkspace: { copyFiles: [".env.test"] },
        });
        spawnGit(root, "add", ".but-why/config.json");
        spawnGit(root, "commit", "-m", "Configure validation workspace copy files");

        const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

        expect(result.status).toBe(1);
        expect(result.stdout).toContain("code: validation_workspace_setup_failed");
        expect(result.stdout).toContain("operationName: copy_allowlisted_file");
        expect(
          validationRunStore(root).getValidationRunById(firstTaskValidationRunId),
        ).toMatchObject({
          status: "error",
        });
        expect(
          validationRunStore(root).listValidationRunToolingErrors(firstTaskValidationRunId),
        ).toEqual([
          expect.objectContaining({
            validationRunId: firstTaskValidationRunId,
            errorKind: "validation_workspace_setup_failed",
            operationName: "copy_allowlisted_file",
            tempRefName: firstTaskValidationRef,
            submittedSha: currentCommitSha(root),
            cleanupWorktree: "not_created",
            cleanupTempRef: "removed",
          }),
        ]);
        expect(taskState(root, "BY-1")).toBe("implementing");
        expect(gitRefExists(root, firstTaskValidationRef)).toBe(false);
        expect(currentCommitSha(root)).not.toBe(commitSha);
      }),
  );

  it.effect(
    "allows needs_input Tasks and increments task-scoped Validation Run IDs after a terminal Validation Run",
    () =>
      Effect.gen(function* () {
        const root = preparedRepoOnBranch("feature/resubmit");

        expect((yield* withFakeGh(() => runSubmit(root, ["BY-1"], secondNow))).status).toBe(0);
        recordValidationRunError(root, firstTaskValidationRunId, secondNow);
        transitionCurrentTaskState(root, "BY-1", "needs_input", secondNow);

        const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`validationRunId: ${secondTaskValidationRunId}`);
      }),
  );

  it.effect("rejects todo Tasks before Git checks", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["submit", "BY-1"],
        thirdNow,
        {
          submitPreflight: fakeSubmitPreflight({
            submitTask: ({ taskId }) => ({
              ok: false,
              kind: "preflight_rejection",
              code: "TASK_STATE_NOT_SUBMITTABLE",
              taskId,
              state: "todo",
            }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: TASK_STATE_NOT_SUBMITTABLE");
    }),
  );

  it.effect("rejects unknown Tasks before Git checks", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["submit", "BY-999"],
        thirdNow,
        {
          submitPreflight: fakeSubmitPreflight({
            submitTask: ({ taskId }) => ({
              ok: false,
              kind: "preflight_rejection",
              code: "TASK_NOT_FOUND",
              taskId,
            }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe(`error:
  code: TASK_NOT_FOUND
  message: "Task was not found: BY-999"
  taskId: BY-999
help[1]: Run \`by task list --all\` to see known Tasks.`);
    }),
  );

  it.effect("rejects remote-style Task IDs after opaque parsing and before Git checks", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["submit", "linear/ENG-123:acceptance"],
        thirdNow,
        {
          submitPreflight: fakeSubmitPreflight({
            resolveTaskId: (taskId) => ({
              ok: false,
              code: "remote_tasks_not_supported",
              taskId,
              help: "Use a repo-local Task ID such as BY-1.",
            }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: remote_tasks_not_supported");
      expect(result.stdout).toContain('taskId: "linear/ENG-123:acceptance"');
    }),
  );

  it.effect("rejects remote-style Task IDs before requiring local state", () =>
    Effect.gen(function* () {
      const root = initializedRepo();
      rmSync(sharedStatePath(root));

      const result = yield* runSubmit(root, ["linear/ENG-123:acceptance"], thirdNow);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: remote_tasks_not_supported");
      expect(result.stdout).toContain('taskId: "linear/ENG-123:acceptance"');
    }),
  );

  it.effect(
    "rejects detached HEAD, dirty worktrees, protected branches, and missing GitHub targets before mutation",
    () =>
      Effect.gen(function* () {
        for (const testCase of [
          {
            name: "detached HEAD",
            setup: (root: string) => {
              spawnGit(root, "checkout", "--detach", "HEAD");
            },
            code: "CURRENT_BRANCH_REQUIRED",
          },
          {
            name: "dirty worktree",
            setup: (root: string) => {
              writeFileSync(join(root, "dirty.txt"), "dirty");
            },
            code: "WORKTREE_NOT_CLEAN",
          },
          {
            name: "protected branch",
            branch: "main",
            setup: () => {},
            code: "PROTECTED_BRANCH",
          },
          {
            name: "missing GitHub target",
            setup: (root: string) => {
              spawnGit(root, "remote", "remove", "origin");
            },
            code: "PR_TARGET_NOT_FOUND",
          },
        ] as const) {
          const root = preparedRepoOnBranch(
            testCase.branch ?? `feature/${testCase.name.replaceAll(" ", "-")}`,
          );
          testCase.setup(root);

          const result = yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow));

          expect(result.status, testCase.name).toBe(1);
          expect(result.stdout, testCase.name).toContain(`code: ${testCase.code}`);
          expect(taskState(root, "BY-1"), testCase.name).toBe("implementing");
          expect(taskHasNoValidationRuns(root, "BY-1"), testCase.name).toBe(true);
        }
      }),
    10_000,
  );

  it.effect("reports GitHub read command failures as tooling errors", () =>
    Effect.gen(function* () {
      const root = preparedRepoOnBranch("feature/github-tooling");

      const result = yield* withFailingGh(() => runSubmit(root, ["BY-1"], thirdNow));

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: tooling_error");
      expect(taskHasNoValidationRuns(root, "BY-1")).toBe(true);
    }),
  );

  it.effect(
    "enforces task branch ownership and active Validation Run uniqueness inside submit preflight",
    () =>
      Effect.gen(function* () {
        const root = preparedRepoOnBranch("feature/owned");
        createTask(root, "Second task");
        spawnGit(root, "add", ".");
        spawnGit(root, "commit", "-m", "Add second task");
        transitionTaskState(root, "BY-2", "implementing", secondNow);

        expect((yield* withFakeGh(() => runSubmit(root, ["BY-1"], secondNow))).status).toBe(0);

        expect((yield* withFakeGh(() => runSubmit(root, ["BY-2"], thirdNow))).stdout).toContain(
          "code: BRANCH_ALREADY_BOUND",
        );
        transitionCurrentTaskState(root, "BY-1", "needs_input", thirdNow);
        expect((yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow))).stdout).toContain(
          "code: TASK_HAS_ACTIVE_VALIDATION_RUN",
        );

        recordValidationRunError(root, firstTaskValidationRunId, thirdNow);
        spawnGit(root, "checkout", "-b", "feature/other");

        expect((yield* withFakeGh(() => runSubmit(root, ["BY-1"], thirdNow))).stdout).toContain(
          "code: TASK_BRANCH_MISMATCH",
        );
      }),
    10_000,
  );

  it.effect("serializes submit success and preflight errors as JSON", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const commitSha = "a".repeat(40);
      const submitPreflight = fakeSubmitPreflight({
        submitTask: ({ taskId }) =>
          taskId === "BY-999"
            ? {
                ok: false,
                kind: "preflight_rejection",
                code: "TASK_NOT_FOUND",
                taskId,
              }
            : {
                ok: true,
                taskId,
                validationRunId: firstTaskValidationRunId,
                branch: "feature/json",
                commitSha,
                taskState: "validating",
                previousTaskState: "implementing",
                prTarget: {
                  owner: "acme",
                  repo: "widgets",
                  baseBranch: "main",
                  remoteName: "origin",
                  remoteUrl: "https://github.com/acme/widgets.git",
                },
              },
        createValidationWorkspaceForValidationRun: () =>
          Effect.succeed({
            ok: true,
            validationWorkspace: {
              validationRunId: firstTaskValidationRunId,
              tempRefName: firstTaskValidationRef,
              submittedSha: commitSha,
              worktreeHead: commitSha,
              cleanupResult: { worktree: "removed", tempRef: "removed" },
            },
          }),
      });

      const success = yield* runByInProcessEffect(
        root,
        ["submit", "BY-1", "--output", "json"],
        thirdNow,
        { submitPreflight },
      );

      expect(success.status).toBe(0);
      expect(JSON.parse(success.stdout)).toMatchObject({
        submission: {
          taskId: "BY-1",
          validationRunId: firstTaskValidationRunId,
          branch: "feature/json",
          taskState: "validating",
          prTarget: {
            owner: "acme",
            repo: "widgets",
            baseBranch: "main",
            remoteName: "origin",
          },
        },
      });

      const missing = yield* runByInProcessEffect(
        root,
        ["submit", "BY-999", "--output", "json"],
        thirdNow,
        { submitPreflight },
      );

      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout)).toEqual({
        error: {
          code: "TASK_NOT_FOUND",
          message: "Task was not found: BY-999",
          taskId: "BY-999",
        },
        help: ["Run `by task list --all` to see known Tasks."],
      });
    }),
  );

  ordinaryIt(
    "runs submit through the executable process boundary",
    async () => {
      const root = preparedRepoOnBranch("feature/process-boundary");

      const success = await withFakeGhProcess(() => runSubmitProcess(root, ["BY-1"], thirdNow));

      expect(success.status).toBe(0);
      expect(success.stderr).toBe("");
      expect(success.stdout).toContain(`validationRunId: ${firstTaskValidationRunId}`);

      const missing = runSubmitProcess(root, ["BY-999", "--output", "json"], thirdNow);

      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout).error.code).toBe("TASK_NOT_FOUND");
    },
    20_000,
  );
});

const initializedRepo = (): string => {
  const root = createInitializedRepo();

  writeRepoConfig(root, {
    taskPrefix: "BY",
    validation: { checks: [{ id: "quality", command: "true" }] },
  });

  return root;
};

const preparedRepoOnBranch = (branch: string, comments: readonly string[] = []): string => {
  const root = initializedRepo();

  createTask(root, "Submit task");
  for (const content of comments) {
    const result = taskStore(root).appendTaskComment({
      taskId: publicTaskId("BY-1"),
      content,
      now: () => secondNow,
    });

    expect(result.ok).toBe(true);
  }
  spawnGit(root, "remote", "add", "origin", "https://github.com/acme/widgets.git");
  spawnGit(root, "add", ".");
  spawnGit(root, "commit", "-m", "Initialize task repo");
  if (currentBranch(root) !== branch) {
    spawnGit(root, "checkout", "-b", branch);
  }

  transitionTaskState(root, "BY-1", "implementing", secondNow);

  return root;
};

const prepareArtifactRefs = (validationRunId: string): readonly string[] =>
  commandArtifactRefs(validationRunId, "prepare", "prepare");

const checkArtifactRefs = (validationRunId: string, producer: string): readonly string[] =>
  commandArtifactRefs(validationRunId, "checks", producer);

const commandArtifactRefs = (
  validationRunId: string,
  phase: string,
  producer: string,
): readonly string[] =>
  ["stdout.txt", "stderr.txt", "exit-code.json", "logs.txt"].map(
    (fileName) => `artifact:${validationRunId}/${phase}/${producer}/${fileName}`,
  );

const writeRepoConfig = (root: string, config: object): void => {
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify(config, null, 2)}\n`);
};

const createTask = (root: string, title: string): void => {
  const description = `Description for ${title}`;

  writeFileSync(join(root, `${title}.md`), description);
  taskStore(root).createTask({ title, description, now: firstNow });
};

const transitionTaskState = (
  root: string,
  id: string,
  state: TaskState,
  updatedAt: string,
): void => {
  const tasksLoad = loadTaskUseCases({
    cwd: root,
    requireState: true,
    migrationTimestamp: () => firstNow,
  });

  if (!tasksLoad.ok) {
    throw new Error(`Could not load Tasks: ${tasksLoad.error.code}`);
  }

  for (const nextState of taskStateTransitionPath(state)) {
    const result = tasksLoad.tasks.transitionTaskState({
      taskId: publicTaskId(id),
      to: nextState,
      now: updatedAt,
    });

    if (!result.ok) {
      throw new Error(`Could not transition ${id} to ${nextState}: ${result.code}`);
    }
  }
};

const transitionCurrentTaskState = (
  root: string,
  id: string,
  state: TaskState,
  updatedAt: string,
): void => {
  const tasksLoad = loadTaskUseCases({
    cwd: root,
    requireState: true,
    migrationTimestamp: () => firstNow,
  });

  if (!tasksLoad.ok) {
    throw new Error(`Could not load Tasks: ${tasksLoad.error.code}`);
  }

  const result = tasksLoad.tasks.transitionTaskState({
    taskId: publicTaskId(id),
    to: state,
    now: updatedAt,
  });

  if (!result.ok) {
    throw new Error(`Could not transition ${id} to ${state}: ${result.code}`);
  }
};

const spawnGit = (root: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });

  expect(result.status, result.stderr).toBe(0);
};

const currentCommitSha = (root: string): string =>
  spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

const currentBranch = (root: string): string =>
  spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).stdout.trim();

const gitStatus = (root: string): string =>
  spawnSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" }).stdout;

const gitRefExists = (root: string, ref: string): boolean =>
  spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).status === 0;

const runSubmit = (root: string, args: readonly string[], now: string) =>
  runByInProcessEffect(root, ["submit", ...args], now, {
    globalConfigPath: join(root, ".test-home/.config/but-why/config.json"),
  });

const runSubmitProcess = (root: string, args: readonly string[], now: string) =>
  runByWithEnv(root, { BUT_WHY_NOW: now, HOME: join(root, ".test-home") }, "submit", ...args);

const installGhScript = (script: string): (() => void) => {
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  const originalPath = process.env["PATH"];
  const bin = createTestWorkspace();
  const ghPath = join(bin, "gh");

  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  // biome-ignore lint/complexity/useLiteralKeys: TS index signature
  process.env["PATH"] = originalPath === undefined ? bin : `${bin}:${originalPath}`;

  return () => {
    if (originalPath === undefined) {
      // biome-ignore lint/complexity/useLiteralKeys: TS index signature
      delete process.env["PATH"];
    } else {
      // biome-ignore lint/complexity/useLiteralKeys: TS index signature
      process.env["PATH"] = originalPath;
    }
  };
};

const withGhScript = <Result, Error, Requirements>(
  script: string,
  work: () => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements> =>
  Effect.acquireUseRelease(
    Effect.sync(() => installGhScript(script)),
    work,
    (restorePath) => Effect.sync(restorePath),
  );

const withGhScriptProcess = async <Result>(
  script: string,
  work: () => Result | Promise<Result>,
): Promise<Result> => {
  const restorePath = installGhScript(script);
  try {
    return await work();
  } finally {
    restorePath();
  }
};

const fakeGhScript = `#!/usr/bin/env sh
set -eu
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '{"defaultBranchRef":{"name":"main"}}\\n'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 1
fi
exit 1
`;

const failingGhScript = `#!/usr/bin/env sh
set -eu
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 1
fi
exit 2
`;

const withFakeGh = <Result, Error, Requirements>(
  work: () => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements> => withGhScript(fakeGhScript, work);

const withFailingGh = <Result, Error, Requirements>(
  work: () => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements> => withGhScript(failingGhScript, work);

const withFakeGhProcess = <Result>(work: () => Result | Promise<Result>): Promise<Result> =>
  withGhScriptProcess(fakeGhScript, work);

const recordValidationRunError = (root: string, validationRunId: string, now: string): void => {
  const result = validationRunStore(root).recordValidationRunError({ validationRunId, now });

  if (!result.ok) {
    throw new Error(`Could not record Validation Run error for ${validationRunId}: ${result.code}`);
  }
};

const taskState = (root: string, taskId: string): string => {
  const task = taskStore(root).getTaskById(publicTaskId(taskId));

  if (task === undefined) {
    throw new Error(`Missing task ${taskId}`);
  }

  return task.state;
};

const taskHasNoValidationRuns = (root: string, taskId: string): boolean =>
  validationRunStore(root).getLatestValidationRunIdForTask(publicTaskId(taskId)) === null;

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const stateDatabase = (root: string) =>
  prepareStateDatabaseSession({
    statePath: sharedStatePath(root),
    migrationTimestamp: () => firstNow,
  });

const taskStore = (root: string) =>
  openSqliteTaskStore({ ...stateDatabase(root), taskPrefix: "BY" });

const validationRuns = (root: string) => openSqliteValidationRuns(stateDatabase(root));

const validationRunStore = (root: string) => openSqliteValidationRunStore(stateDatabase(root));
