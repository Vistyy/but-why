import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import { provisionChangeWorktree } from "../../src/change/adapters/changeStartGit.js";
import type { ChangeStartRecord } from "../../src/change/changeStartStore.js";
import { openSqliteChangeStartPersistence } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeStartPersistence.js";
import { defaultAcceptanceInstructions } from "../../src/reviewerPrompts/acceptanceReviewerPrompt.js";
import { refreshRemoteChangeBase } from "../../src/submissionEnvironment/adapters/remoteChangeBase.js";
import { passTaskReviewFixture, runByInProcessEffect } from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";

let initializedRepositoryTemplate: string;

beforeAll(() => {
  initializedRepositoryTemplate = acquireTestWorkspace();
  initializedRepository(initializedRepositoryTemplate);
});

afterAll(() => {
  releaseTestWorkspace(initializedRepositoryTemplate);
});

const repositoryCopy = () => cloneInitializedTestRepository(initializedRepositoryTemplate);

describe("Change Start Managed Worktree boundaries", () => {
  it.effect(
    "creates a ready Change without a Task from the freshly fetched remote default branch",
    () =>
      Effect.gen(function* () {
        const root = yield* repositoryCopy();
        writeFileSync(join(root, "dirty.txt"), "caller work is not part of Change Start\n");

        const result = yield* runByInProcessEffect(root, ["change", "start"], now);

        expect(result.status).toBe(0);
        const output = JSON.parse(result.stdout) as ChangeOutput;
        const startingCommit = git(root, "rev-parse", "refs/remotes/origin/main^{commit}");
        expect(output).toMatchObject({
          change: { id: expect.any(String), taskId: null },
          branch: expect.stringMatching(/^refs\/heads\/but-why\/BY-C[1-9][0-9]*$/u),
          baseRef: "refs/remotes/origin/main",
          worktreePath: expect.any(String),
        });
        expect(output.worktreePath).toMatch(
          new RegExp(
            `^${escapeRegExp(join(dirname(root), `${basename(root)}-worktrees`, "but-why"))}/BY-C[1-9][0-9]*$`,
            "u",
          ),
        );
        expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
        expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
        expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
        const persisted = yield* withTestRepository(
          root,
          Effect.gen(function* () {
            const changes = yield* openSqliteChangeStartPersistence();
            return yield* changes.getById(output.change.id);
          }),
        );
        expect(persisted?.policy.prepare).toBeNull();
      }),
  );

  it.effect("rejects a Change Base without Checks before creating a Change", () =>
    Effect.gen(function* () {
      const root = initializedRepository();
      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify({ idPrefix: "BY" }, null, 2)}\n`,
      );
      git(root, "add", ".but-why/config.json");
      git(root, "commit", "-m", "Remove required Checks");

      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(1);
      expect(JSON.parse(started.stdout)).toMatchObject({
        error: {
          code: "reviewer_configuration_invalid",
          message: "Repo config must define at least one validation.checks entry.",
        },
      });

      const listed = yield* runByInProcessEffect(root, ["change", "list", "--all"], now);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual({ changes: [] });
    }),
  );

  it.effect("ignores the retired Change Start placeholder branch", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      git(root, "branch", "but-why/pending-change-start", "main");
      const placeholderCommit = git(
        root,
        "rev-parse",
        "refs/heads/but-why/pending-change-start^{commit}",
      );

      const started = yield* runByInProcessEffect(root, ["change", "start"], now);

      expect(started.status).toBe(0);
      expect(JSON.parse(started.stdout)).toMatchObject({
        branch: expect.stringMatching(/^refs\/heads\/but-why\/BY-C[1-9][0-9]*$/u),
      });
      expect(git(root, "rev-parse", "refs/heads/but-why/pending-change-start^{commit}")).toBe(
        placeholderCommit,
      );
    }),
  );

  it.effect("ignores an ahead local branch and preserves it unchanged", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const remoteCommit = git(root, "rev-parse", "refs/remotes/origin/main^{commit}");
      writeFileSync(join(root, "local-only.txt"), "not published\n");
      git(root, "add", "local-only.txt");
      git(root, "commit", "-m", "Local-only commit");
      const localCommit = git(root, "rev-parse", "refs/heads/main^{commit}");

      const started = yield* runByInProcessEffect(root, ["change", "start"], now);

      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(remoteCommit);
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(remoteCommit);
      expect(git(root, "rev-parse", "refs/heads/main^{commit}")).toBe(localCommit);
      expect(existsSync(join(output.worktreePath, "local-only.txt"))).toBe(false);
    }),
  );

  it.effect("fetches a requested publication-remote branch", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const remote = yield* repositoryCopy();
      git(remote, "branch", "release", "main");
      configurePublicationRemote(root, remote);
      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--base", "release"],
        now,
      );

      expect(started.status).toBe(0);
      expect(JSON.parse(started.stdout)).toMatchObject({
        baseRef: "refs/remotes/origin/release",
      });
    }),
  );

  it.effect("rejects a missing remote branch before recording a Change", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();

      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--base", "missing"],
        now,
      );

      expect(started.status).toBe(1);
      expect(JSON.parse(started.stdout)).toMatchObject({
        error: { code: "remote_branch_missing", remoteName: "origin", branchName: "missing" },
        help: [expect.stringContaining("retry Change Start")],
      });
      const listed = yield* runByInProcessEffect(root, ["change", "list"], now);
      expect(JSON.parse(listed.stdout)).toEqual({ changes: [] });
    }),
  );

  it.effect("does not start a Task when the publication remote is missing", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const taskId = yield* createTask(root, "Remote required", "Do not start without it.\n");
      yield* passTaskReviewFixture(root, taskId, now);
      git(root, "remote", "remove", "origin");

      const started = yield* runByInProcessEffect(root, ["change", "start", "--task", taskId], now);

      expect(started.status).toBe(1);
      expect(JSON.parse(started.stdout)).toMatchObject({
        error: { code: "publication_remote_missing" },
        help: [expect.stringContaining("retry Change Start")],
      });
      const task = yield* runByInProcessEffect(root, ["task", "show", taskId], now);
      expect(JSON.parse(task.stdout)).toMatchObject({ task: { id: taskId, state: "todo" } });
    }),
  );

  it.effect("starts an approved Task with the complete exact-base Change Policy", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const taskId = yield* createTask(root, "Existing Todo", "Start approved work.\n");
      yield* passTaskReviewFixture(root, taskId, now);
      const instructionsPath = join(root, ".but-why", "reviewers", "standards.md");
      mkdirSync(dirname(instructionsPath), { recursive: true });
      writeFileSync(instructionsPath, "Review the committed exact-base policy.\n");
      writeFileSync(
        join(root, ".but-why", "config.json"),
        `${JSON.stringify(
          {
            idPrefix: "BY",
            agentEnvironment: { command: ["env"] },
            prepare: { command: "true" },
            validation: {
              checks: [
                { id: "first", command: "true" },
                { id: "second", command: "true", timeoutSeconds: 45 },
              ],
            },
            review: {
              acceptance: { agentProfile: { scope: "global", name: "test" } },
              specialists: ["standards"],
            },
            reviewers: {
              standards: { instructionsFile: ".but-why/reviewers/standards.md" },
            },
          },
          null,
          2,
        )}\n`,
      );
      git(root, "add", ".but-why/config.json", ".but-why/reviewers/standards.md");
      git(root, "commit", "-m", "Configure complete Change Policy");
      git(root, "config", "--unset-all", `url.${initializedRepositoryTemplate}.insteadOf`);
      configurePublicationRemote(root, root);
      writeFileSync(instructionsPath, "Current checkout policy must not win.\n");

      const started = yield* runByInProcessEffect(root, ["change", "start", "--task", taskId], now);
      expect(started.status, started.stdout).toBe(0);
      const startedOutput = JSON.parse(started.stdout) as ChangeOutput;
      expect(startedOutput).toMatchObject({ change: { taskId } });

      const persisted = yield* withTestRepository(
        root,
        Effect.gen(function* () {
          const changes = yield* openSqliteChangeStartPersistence();
          return yield* changes.getById(startedOutput.change.id);
        }),
      );
      expect(persisted).toEqual({
        id: startedOutput.change.id,
        repositoryCommonDirectory: join(root, ".git"),
        branchRef: startedOutput.branch,
        baseRef: "refs/remotes/origin/main",
        baseRemoteUrl: expect.any(String),
        worktreePath: startedOutput.worktreePath,
        acceptanceContext: {
          version: 1,
          title: "Existing Todo",
          description: "Start approved work.\n",
        },
        policy: {
          reviewerConfiguration: {
            acceptanceReview: {
              instructions: defaultAcceptanceInstructions,
              instructionsSource: "built_in",
              profile: {
                agentProfile: "test",
                scope: "global",
                profile: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
                globalConfigDirectory: root,
              },
            },
            specialistReviews: [
              {
                id: "standards",
                instructions: "Review the committed exact-base policy.\n",
                instructionsSource: "repo",
                profile: {
                  agentProfile: "test",
                  scope: "global",
                  profile: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
                  globalConfigDirectory: root,
                },
              },
            ],
            agentEnvironment: ["env"],
          },
          prepare: { command: "true", timeoutSeconds: 1200 },
          checks: [
            { id: "first", command: "true", timeoutSeconds: 1200 },
            { id: "second", command: "true", timeoutSeconds: 45 },
          ],
        },
        prepareFailure: null,
        state: "open",
      });
    }),
  );

  it.effect("recovers a linked Change without rereading current reviewer configuration", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const taskId = yield* createTask(
        root,
        "Recover without current policy",
        "Keep the recorded policy.\n",
      );
      yield* passTaskReviewFixture(root, taskId, now);
      const globalConfigPath = join(root, ".test-global-config.json");

      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", taskId],
        now,
        { globalConfigPath },
      );
      expect(started.status).toBe(0);
      const startedOutput = JSON.parse(started.stdout) as ChangeOutput;

      writeFileSync(globalConfigPath, "malformed");
      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "start", "--task", taskId],
        now,
        { globalConfigPath },
      );

      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: { id: startedOutput.change.id, taskId },
      });
    }),
  );

  it.effect("rejects a local-only remote as a publication remote", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      git(root, "remote", "set-url", "origin", root);

      const started = yield* runByInProcessEffect(root, ["change", "start"], now);

      expect(started.status).toBe(1);
      expect(JSON.parse(started.stdout)).toMatchObject({
        error: { code: "publication_remote_missing" },
      });
    }),
  );

  it.effect("rejects ambiguous publication remotes", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      git(root, "remote", "remove", "origin");
      configurePublicationRemote(root, initializedRepositoryTemplate, "upstream");
      configurePublicationRemote(root, initializedRepositoryTemplate, "fork");

      const started = yield* runByInProcessEffect(root, ["change", "start"], now);

      expect(started.status).toBe(1);
      expect(JSON.parse(started.stdout)).toMatchObject({
        error: {
          code: "publication_remote_ambiguous",
          remoteNames: ["fork", "upstream"],
        },
      });
    }),
  );

  it.effect("reports an unreachable publication remote", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      configurePublicationRemote(root, join(root, "missing-remote"));

      const started = yield* runByInProcessEffect(root, ["change", "start"], now);

      expect(started.status).toBe(1);
      expect(JSON.parse(started.stdout)).toMatchObject({
        error: { code: "publication_remote_unreachable", remoteName: "origin" },
      });
    }),
  );

  it.effect("rejects a publication remote URL change during refresh", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const expectedRemoteUrl = git(root, "config", "--get", "remote.origin.url");
      git(root, "remote", "set-url", "origin", "https://github.com/acme/other.git");

      expect(refreshRemoteChangeBase(root, "refs/remotes/origin/main", expectedRemoteUrl)).toEqual({
        ok: false,
        code: "publication_remote_changed",
        remoteName: "origin",
        expectedRemoteUrl,
        actualRemoteUrl: "https://github.com/acme/other.git",
      });
    }),
  );

  it.effect("uses the invoking worktree without selecting a privileged checkout", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const originUrl = git(root, "config", "--get", "remote.origin.url");
      configurePublicationRemote(root, initializedRepositoryTemplate, "upstream");
      git(root, "config", "--add", `url.${initializedRepositoryTemplate}.insteadOf`, originUrl);
      git(root, "config", "branch.main.remote", "upstream");
      git(root, "config", "branch.main.merge", "refs/heads/main");
      const linkedWorktree = join(dirname(root), `${basename(root)}-linked-caller`);
      git(root, "worktree", "add", "-b", "linked-caller", linkedWorktree, "main");

      const fromMain = yield* runByInProcessEffect(root, ["change", "start"], now);
      const fromLinked = yield* runByInProcessEffect(linkedWorktree, ["change", "start"], now);

      expect(fromMain.status, fromMain.stdout).toBe(0);
      expect(fromLinked.status, fromLinked.stdout).toBe(0);
      const mainOutput = JSON.parse(fromMain.stdout) as ChangeOutput;
      const linkedOutput = JSON.parse(fromLinked.stdout) as ChangeOutput;
      expect(mainOutput).toMatchObject({
        baseRef: "refs/remotes/upstream/main",
      });
      expect(linkedOutput).toMatchObject({
        baseRef: "refs/remotes/origin/main",
      });
      expect(dirname(dirname(mainOutput.worktreePath))).toBe(
        join(dirname(root), `${basename(root)}-worktrees`),
      );
      expect(dirname(dirname(linkedOutput.worktreePath))).toBe(
        join(dirname(linkedWorktree), `${basename(linkedWorktree)}-worktrees`),
      );
    }),
  );

  it.effect("recovers after an actionable sibling-path failure", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const taskId = yield* createTask(root, "Blocked path", "Recover this Change.\n");
      yield* passTaskReviewFixture(root, taskId, now);
      const siblingRoot = join(dirname(root), `${basename(root)}-worktrees`);
      writeFileSync(siblingRoot, "occupied\n");

      const failed = yield* runByInProcessEffect(root, ["change", "start", "--task", taskId], now);

      expect(failed.status).toBe(1);
      const failure = JSON.parse(failed.stdout);
      expect(failure).toMatchObject({
        error: {
          code: "managed_worktree_path_unavailable",
          changeId: expect.any(String),
          worktreePath: expect.stringMatching(
            new RegExp(`^${escapeRegExp(join(siblingRoot, "but-why", "BY-C"))}[1-9][0-9]*$`, "u"),
          ),
        },
        help: [
          expect.stringContaining("Make the parent directory writable"),
          expect.stringContaining("suitable ownership"),
          expect.stringContaining("Move the repository to a writable parent"),
        ],
      });

      rmSync(siblingRoot);
      const retried = yield* runByInProcessEffect(
        root,
        ["change", "prepare", failure.error.changeId],
        now,
      );
      expect(retried.status).toBe(0);
      expect(existsSync(failure.error.worktreePath)).toBe(true);
      expect(git(failure.error.worktreePath, "symbolic-ref", "HEAD")).toBe(failure.error.branch);
    }),
  );

  it.effect("recovers the Managed Worktree at the recorded branch's advanced commit", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      writeFileSync(join(output.worktreePath, "advanced.txt"), "preserve this commit\n");
      git(output.worktreePath, "add", "advanced.txt");
      git(output.worktreePath, "commit", "-m", "Advanced commit");
      const advancedCommit = git(output.worktreePath, "rev-parse", "HEAD^{commit}");
      expect(advancedCommit).not.toBe(git(root, "rev-parse", "refs/remotes/origin/main"));

      git(root, "worktree", "remove", output.worktreePath);

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: { id: output.change.id },
        worktreePath: output.worktreePath,
      });
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(advancedCommit);
      expect(existsSync(join(output.worktreePath, "advanced.txt"))).toBe(true);
      expect(git(root, "rev-parse", output.branch)).toBe(advancedCommit);
    }),
  );

  it.effect("recovers a stale Managed Worktree registration", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      rmSync(output.worktreePath, { recursive: true });
      expect(git(root, "worktree", "list", "--porcelain")).toContain("prunable");

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: { id: output.change.id },
        worktreePath: output.worktreePath,
      });
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
      expect(git(root, "worktree", "list", "--porcelain")).not.toContain("prunable");
    }),
  );

  it.effect("stops recovery when the recorded branch is missing", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      git(root, "worktree", "remove", output.worktreePath);
      git(root, "branch", "-D", output.branch.slice("refs/heads/".length));

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(1);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        error: {
          code: "managed_branch_missing",
          changeId: output.change.id,
          branch: output.branch,
          worktreePath: output.worktreePath,
        },
        help: [
          expect.stringContaining("Recover the recorded branch externally"),
          expect.stringContaining(`by change cancel ${output.change.id} --reason "<reason>"`),
        ],
      });
      expect(existsSync(output.worktreePath)).toBe(false);
    }),
  );

  it.effect("stops recovery when the recorded branch is attached elsewhere", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      git(root, "worktree", "remove", output.worktreePath);
      const otherWorktree = join(dirname(root), `${basename(root)}-other`);
      git(root, "worktree", "add", otherWorktree, output.branch.slice("refs/heads/".length));

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(1);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        error: {
          code: "managed_branch_attached",
          changeId: output.change.id,
          branch: output.branch,
          worktreePath: output.worktreePath,
          attachedPath: otherWorktree,
        },
        help: [
          expect.stringContaining("Remove or relocate the worktree that holds the branch"),
          expect.stringContaining(`by change cancel ${output.change.id} --reason "<reason>"`),
        ],
      });
      expect(existsSync(output.worktreePath)).toBe(false);
      expect(git(otherWorktree, "symbolic-ref", "HEAD")).toBe(output.branch);
    }),
  );

  it.effect("stops recovery when the recorded path contains conflicting files", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      git(root, "worktree", "remove", output.worktreePath);
      mkdirSync(output.worktreePath, { recursive: true });
      writeFileSync(join(output.worktreePath, "keep.txt"), "do not overwrite\n");

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(1);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        error: {
          code: "managed_worktree_path_conflict",
          changeId: output.change.id,
          branch: output.branch,
          worktreePath: output.worktreePath,
        },
        help: [
          expect.stringContaining("Move the conflicting files aside or remove them"),
          expect.stringContaining(`by change cancel ${output.change.id} --reason "<reason>"`),
        ],
      });
      expect(existsSync(join(output.worktreePath, "keep.txt"))).toBe(true);
    }),
  );

  it.effect("stops recovery when the recorded path conflicts under a stale registration", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const started = yield* runByInProcessEffect(root, ["change", "start"], now);
      expect(started.status).toBe(0);
      const output = JSON.parse(started.stdout) as ChangeOutput;
      rmSync(output.worktreePath, { recursive: true });
      mkdirSync(output.worktreePath, { recursive: true });
      writeFileSync(join(output.worktreePath, "keep.txt"), "do not overwrite\n");
      expect(git(root, "worktree", "list", "--porcelain")).toContain("prunable");

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(1);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        error: {
          code: "managed_worktree_path_conflict",
          changeId: output.change.id,
          branch: output.branch,
          worktreePath: output.worktreePath,
        },
        help: [
          expect.stringContaining("Move the conflicting files aside or remove them"),
          expect.stringContaining(`by change cancel ${output.change.id} --reason "<reason>"`),
        ],
      });
      expect(existsSync(join(output.worktreePath, "keep.txt"))).toBe(true);
    }),
  );

  it.effect("rejects a symlinked Managed Worktree container", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const symlinkTarget = join(dirname(root), `${basename(root)}-symlink-target`);
      const siblingRoot = join(dirname(root), `${basename(root)}-worktrees`);
      mkdirSync(symlinkTarget);
      symlinkSync(symlinkTarget, siblingRoot, "dir");
      const start = {
        ...changeStartRecord(root),
        worktreePath: join(siblingRoot, "but-why", "change-1"),
      };

      expect(provisionChangeWorktree(root, start, false, start.startingCommit)).toEqual({
        ok: false,
        code: "managed_worktree_path_unavailable",
        path: start.worktreePath,
      });
      expect(existsSync(join(symlinkTarget, "but-why"))).toBe(false);
    }),
  );

  it.effect("rejects recovery through a symlinked Managed Worktree container", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const symlinkTarget = join(dirname(root), `${basename(root)}-symlink-target`);
      const siblingRoot = join(dirname(root), `${basename(root)}-worktrees`);
      const actualWorktree = join(symlinkTarget, "but-why", "change-1");
      git(root, "worktree", "add", "-b", "but-why/change-1", actualWorktree, "main");
      symlinkSync(symlinkTarget, siblingRoot, "dir");
      const start = {
        ...changeStartRecord(root),
        worktreePath: join(siblingRoot, "but-why", "change-1"),
      };

      expect(provisionChangeWorktree(root, start, true, start.startingCommit)).toEqual({
        ok: false,
        code: "managed_worktree_path_unavailable",
        path: start.worktreePath,
      });
      expect(existsSync(actualWorktree)).toBe(true);
    }),
  );

  it.effect("reports non-path Git failures as tooling errors", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
      const hookPath = join(commonDirectory, "hooks", "post-checkout");
      writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
      chmodSync(hookPath, 0o755);
      const start = {
        ...changeStartRecord(root),
        worktreePath: join(dirname(root), `${basename(root)}-worktrees`, "but-why", "change-1"),
      };

      expect(provisionChangeWorktree(root, start, false, start.startingCommit)).toEqual({
        ok: false,
        code: "git_tooling_error",
      });
    }),
  );

  it.effect("reattaches the recorded branch at its unrelated current commit", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const start = changeStartRecord(root);
      expect(provisionChangeWorktree(root, start, false, start.startingCommit)).toEqual({
        ok: true,
      });
      git(root, "worktree", "remove", start.worktreePath);
      const emptyTree = git(root, "mktree");
      const currentCommit = git(root, "commit-tree", emptyTree, "-m", "Current branch commit");
      git(root, "update-ref", start.branchRef, currentCommit);

      expect(provisionChangeWorktree(root, start, true, start.startingCommit)).toEqual({
        ok: true,
      });
      expect(git(start.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(currentCommit);
    }),
  );

  it.effect("reports a recorded branch observation failure as a tooling error", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const start = changeStartRecord(root);
      expect(provisionChangeWorktree(root, start, false, start.startingCommit)).toEqual({
        ok: true,
      });
      git(root, "worktree", "remove", start.worktreePath);
      const blobPath = join(root, "not-a-commit.txt");
      writeFileSync(blobPath, "not a commit\n");
      const blob = git(root, "hash-object", "-w", blobPath);
      writeFileSync(join(start.repositoryCommonDirectory, start.branchRef), `${blob}\n`);

      expect(provisionChangeWorktree(root, start, true, start.startingCommit)).toEqual({
        ok: false,
        code: "git_tooling_error",
      });
      expect(existsSync(start.worktreePath)).toBe(false);
    }),
  );

  it.effect("preserves unexpected branches and occupied Managed Worktree paths", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const start = changeStartRecord(root);
      git(root, "branch", start.branchRef.slice("refs/heads/".length), start.startingCommit);

      expect(provisionChangeWorktree(root, start, false, start.startingCommit)).toEqual({
        ok: false,
        code: "change_start_conflict",
      });

      git(root, "branch", "-D", start.branchRef.slice("refs/heads/".length));
      mkdirSync(start.worktreePath, { recursive: true });
      writeFileSync(join(start.worktreePath, "keep.txt"), "do not overwrite\n");
      expect(provisionChangeWorktree(root, start, false, start.startingCommit)).toEqual({
        ok: false,
        code: "managed_worktree_path_conflict",
        branch: start.branchRef,
        path: start.worktreePath,
      });
      expect(existsSync(join(start.worktreePath, "keep.txt"))).toBe(true);

      rmSync(start.worktreePath, { recursive: true });
      expect(provisionChangeWorktree(root, start, true, start.startingCommit)).toEqual({
        ok: true,
      });
      expect(git(start.worktreePath, "symbolic-ref", "HEAD")).toBe(start.branchRef);
    }),
  );
});

type ChangeOutput = {
  readonly change: {
    readonly id: string;
    readonly taskId: string | null;
  };
  readonly branch: string;
  readonly baseRef: string;
  readonly worktreePath: string;
  readonly prepareFailure?: {
    readonly command: string;
    readonly exitCode: number;
    readonly timedOut: boolean;
    readonly stdout: string;
    readonly stderr: string;
  };
};

const initializedRepository = (workspace?: string): string => {
  const root = createInitializedRepo(workspace);
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  writeFileSync(
    join(root, ".test-global-config.json"),
    JSON.stringify({
      defaultAgentProfile: { scope: "global", name: "test" },
      agentProfiles: { test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } } },
    }),
  );
  git(root, "branch", "-M", "main");
  writeFileSync(
    join(root, ".but-why", "config.json"),
    `${JSON.stringify(
      {
        idPrefix: "BY",
        validation: { checks: [{ id: "test", command: "true", timeoutSeconds: 30 }] },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".but-why/config.json");
  git(root, "commit", "-m", "Initialize repository");
  configurePublicationRemote(root, root);
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const configurePublicationRemote = (
  root: string,
  remotePath: string,
  remoteName = "origin",
): void => {
  const repository = `${basename(remotePath).replace(/[^a-zA-Z0-9-]/gu, "-")}-${remoteName}`;
  const url = `https://github.com/acme/${repository}.git`;
  git(root, "config", `url.${remotePath}.insteadOf`, url);
  const remotes = git(root, "remote").split("\n");
  if (remotes.includes(remoteName)) git(root, "remote", "set-url", remoteName, url);
  else git(root, "remote", "add", remoteName, url);
};

const changeStartRecord = (
  root: string,
): ChangeStartRecord & { readonly startingCommit: string } => {
  const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return {
    id: "change-1",
    repositoryCommonDirectory: commonDirectory,
    branchRef: "refs/heads/but-why/change-1",
    baseRef: "refs/heads/main",
    baseRemoteUrl: "https://github.com/acme/repo.git",
    startingCommit: git(root, "rev-parse", "refs/heads/main"),
    worktreePath: join(commonDirectory, "but-why", "worktrees", "change-1"),
    acceptanceContext: null,
    policy: {
      reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
      prepare: null,
      checks: [{ id: "quality", command: "true", timeoutSeconds: 30 }],
    },
    prepareFailure: null,
    state: "open",
  };
};

const createTask = (root: string, title: string, description: string) =>
  Effect.gen(function* () {
    const descriptionPath = join(root, `.task-${title.toLowerCase()}.md`);
    writeFileSync(descriptionPath, description);
    const created = yield* runByInProcessEffect(
      root,
      ["task", "create", "--title", title, "--file", descriptionPath],
      now,
    );
    expect(created.status).toBe(0);
    return (JSON.parse(created.stdout) as { readonly task: { readonly id: string } }).task.id;
  });

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
