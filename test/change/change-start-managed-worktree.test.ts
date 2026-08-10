import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import { provisionChangeWorktree } from "../../src/change/changeStartGit.js";
import type { ChangeStartRecord } from "../../src/change/changeStartStore.js";
import { refreshRemoteChangeBase } from "../../src/submissionEnvironment/remoteChangeBase.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
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
  it.effect("creates a ready taskless Change from the freshly fetched remote default branch", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      writeFileSync(join(root, "dirty.txt"), "caller work is not part of Change Start\n");

      const result = yield* runByInProcessEffect(root, ["change", "start"], now);

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as ChangeOutput;
      const startingCommit = git(root, "rev-parse", "refs/remotes/origin/main^{commit}");
      expect(output).toMatchObject({
        change: { id: expect.any(String), taskId: null },
        branch: expect.stringMatching(/^refs\/heads\/but-why\/change-/u),
        baseRef: "refs/remotes/origin/main",
        startingCommit,
        worktreePath: expect.any(String),
      });
      expect(output.worktreePath).toMatch(
        new RegExp(
          `^${escapeRegExp(join(dirname(root), `${basename(root)}-worktrees`, "but-why"))}/change-`,
          "u",
        ),
      );
      expect(git(output.worktreePath, "symbolic-ref", "HEAD")).toBe(output.branch);
      expect(git(output.worktreePath, "rev-parse", "HEAD^{commit}")).toBe(startingCommit);
      expect(existsSync(join(output.worktreePath, "dirty.txt"))).toBe(false);
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
      expect(output.startingCommit).toBe(remoteCommit);
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
      const releaseCommit = git(remote, "rev-parse", "refs/heads/release^{commit}");

      const started = yield* runByInProcessEffect(
        root,
        ["change", "start", "--base", "release"],
        now,
      );

      expect(started.status).toBe(0);
      expect(JSON.parse(started.stdout)).toMatchObject({
        baseRef: "refs/remotes/origin/release",
        startingCommit: releaseCommit,
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
      expect((yield* runByInProcessEffect(root, ["task", "approve", taskId], now)).status).toBe(0);
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

  it.effect("uses the canonical main checkout upstream from main and linked worktrees", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      configurePublicationRemote(root, initializedRepositoryTemplate, "upstream");
      git(root, "config", "branch.main.remote", "upstream");
      const linkedWorktree = join(dirname(root), `${basename(root)}-linked-caller`);
      git(root, "worktree", "add", "-b", "linked-caller", linkedWorktree, "main");

      const fromMain = yield* runByInProcessEffect(root, ["change", "start"], now);
      const fromLinked = yield* runByInProcessEffect(linkedWorktree, ["change", "start"], now);

      expect(fromMain.status).toBe(0);
      expect(fromLinked.status).toBe(0);
      const mainOutput = JSON.parse(fromMain.stdout) as ChangeOutput;
      const linkedOutput = JSON.parse(fromLinked.stdout) as ChangeOutput;
      const upstreamCommit = git(root, "rev-parse", "refs/remotes/upstream/main^{commit}");
      expect(mainOutput).toMatchObject({
        baseRef: "refs/remotes/upstream/main",
        startingCommit: upstreamCommit,
      });
      expect(linkedOutput).toMatchObject({
        baseRef: "refs/remotes/upstream/main",
        startingCommit: upstreamCommit,
      });
      expect(dirname(dirname(linkedOutput.worktreePath))).toBe(
        join(dirname(root), `${basename(root)}-worktrees`),
      );
    }),
  );

  it.effect(
    "reports an actionable sibling-path failure and then stops recovery while the branch is missing",
    () =>
      Effect.gen(function* () {
        const root = yield* repositoryCopy();
        const taskId = yield* createTask(root, "Blocked path", "Recover this Change.\n");
        expect((yield* runByInProcessEffect(root, ["task", "approve", taskId], now)).status).toBe(
          0,
        );
        const siblingRoot = join(dirname(root), `${basename(root)}-worktrees`);
        writeFileSync(siblingRoot, "occupied\n");

        const failed = yield* runByInProcessEffect(
          root,
          ["change", "start", "--task", taskId],
          now,
        );

        expect(failed.status).toBe(1);
        const failure = JSON.parse(failed.stdout);
        expect(failure).toMatchObject({
          error: {
            code: "managed_worktree_path_unavailable",
            changeId: expect.any(String),
            worktreePath: expect.stringMatching(
              new RegExp(
                `^${escapeRegExp(join(siblingRoot, "but-why", `${taskId.toLowerCase()}-`))}`,
                "u",
              ),
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
          ["change", "start", "--task", taskId],
          now,
        );
        expect(retried.status).toBe(1);
        const retryFailure = JSON.parse(retried.stdout);
        expect(retryFailure).toMatchObject({
          error: {
            code: "managed_branch_missing",
            changeId: failure.error.changeId,
            worktreePath: failure.error.worktreePath,
          },
          help: [
            expect.stringContaining("Recover the branch externally"),
            expect.stringContaining(`by task cancel ${taskId}`),
          ],
        });
        expect(existsSync(failure.error.worktreePath)).toBe(false);
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
      expect(advancedCommit).not.toBe(output.startingCommit);

      git(root, "worktree", "remove", output.worktreePath);

      const recovered = yield* runByInProcessEffect(
        root,
        ["change", "prepare", output.change.id],
        now,
      );
      expect(recovered.status).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        change: output.change,
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
        change: output.change,
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
          startingCommit: output.startingCommit,
          worktreePath: output.worktreePath,
        },
        help: [
          expect.stringContaining("Recover the branch externally"),
          expect.stringContaining(`by change cancel ${output.change.id} --reason "<reason>"`),
        ],
      });
      expect(git(root, "branch", "--list", output.branch.slice("refs/heads/".length))).toBe("");
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

      expect(provisionChangeWorktree(root, start, false)).toEqual({
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

      expect(provisionChangeWorktree(root, start, true)).toEqual({
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

      expect(provisionChangeWorktree(root, start, false)).toEqual({
        ok: false,
        code: "git_tooling_error",
      });
    }),
  );

  it.effect("preserves unexpected branches and occupied Managed Worktree paths", () =>
    Effect.gen(function* () {
      const root = yield* repositoryCopy();
      const start = changeStartRecord(root);
      git(root, "branch", start.branchRef.slice("refs/heads/".length), start.startingCommit);

      expect(provisionChangeWorktree(root, start, false)).toEqual({
        ok: false,
        code: "change_start_conflict",
      });

      git(root, "branch", "-D", start.branchRef.slice("refs/heads/".length));
      mkdirSync(start.worktreePath, { recursive: true });
      writeFileSync(join(start.worktreePath, "keep.txt"), "do not overwrite\n");
      expect(provisionChangeWorktree(root, start, false)).toEqual({
        ok: false,
        code: "managed_worktree_path_conflict",
        branch: start.branchRef,
        path: start.worktreePath,
      });
      expect(existsSync(join(start.worktreePath, "keep.txt"))).toBe(true);

      rmSync(start.worktreePath, { recursive: true });
      expect(provisionChangeWorktree(root, start, false)).toEqual({ ok: true });
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
  readonly startingCommit: string;
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
  git(root, "branch", "-M", "main");
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", "README.md", ".gitignore", ".but-why/config.json");
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

const changeStartRecord = (root: string): ChangeStartRecord => {
  const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return {
    id: "change-1",
    repositoryCommonDirectory: commonDirectory,
    branchRef: "refs/heads/but-why/change-1",
    baseRef: "refs/heads/main",
    baseRemoteUrl: "https://github.com/acme/repo.git",
    taskId: null,
    startingCommit: git(root, "rev-parse", "refs/heads/main"),
    worktreePath: join(commonDirectory, "but-why", "worktrees", "change-1"),
    acceptanceContext: null,
    prepare: null,
    prepareFailure: null,
    publication: null,
    cleanup: { state: "pending", blockingReason: null },
    state: "open",
    closeReason: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
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
