import { spawnSync } from "node:child_process";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import {
  localCandidateCaptureGit,
  readRepositoryBranchHead,
} from "../../src/change/candidateCapture/localGitCandidate.js";
import { createGitRepo } from "../support/by-cli.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const now = "2026-07-12T10:00:00.000Z";
let committedRepoTemplate: string;
let captureReadyRepoTemplate: string;

beforeAll(() => {
  committedRepoTemplate = acquireTestWorkspace();
  committedRepo(committedRepoTemplate);
  captureReadyRepoTemplate = acquireTestWorkspace();
  captureReadyRepo(captureReadyRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(committedRepoTemplate);
  releaseTestWorkspace(captureReadyRepoTemplate);
});

const committedRepoCopy = (): string => {
  const root = createTestWorkspace();
  cpSync(committedRepoTemplate, root, { recursive: true });
  return root;
};

const captureReadyRepoCopy = () => cloneInitializedTestRepository(captureReadyRepoTemplate);

describe("Change Candidate capture boundaries", () => {
  it.effect("captures committed work against the recorded remote default", () =>
    Effect.gen(function* () {
      const repo = yield* captureReadyRepoCopy();
      const mainSha = git(repo, "rev-parse", "refs/remotes/origin/main");
      const headSha = git(repo, "rev-parse", "HEAD");

      const result = yield* captureLocalCandidate({ cwd: repo, now });

      expect(result).toEqual({
        ok: true,
        changeId: expect.any(String),
        candidateId: expect.any(String),
        branchRef: "refs/heads/feature",
        changeBaseSha: mainSha,
        headSha,
        trackedTreeMatchesChangeBase: false,
      });

      if (!result.ok) return;
      const tree = git(repo, "rev-parse", "refs/remotes/origin/main^{tree}");
      const movedTarget = git(
        repo,
        "commit-tree",
        tree,
        "-p",
        "refs/remotes/origin/main",
        "-m",
        "move base",
      );
      git(repo, "update-ref", "refs/remotes/origin/main", movedTarget);
      const refreshed = yield* captureLocalCandidate({
        cwd: repo,
        now: "2026-07-12T11:00:00.000Z",
      });
      expect(refreshed).toEqual({
        ok: false,
        code: "change_base_not_ancestor",
        branchRef: "refs/heads/feature",
        headSha,
        changeBaseRef: "refs/remotes/origin/main",
        changeBaseSha: movedTarget,
      });

      git(repo, "merge", "--no-edit", "refs/remotes/origin/main");
      const merged = yield* captureLocalCandidate({
        cwd: repo,
        now: "2026-07-12T11:05:00.000Z",
      });
      expect(merged).toMatchObject({
        ok: true,
        changeId: result.changeId,
        changeBaseSha: movedTarget,
      });
    }),
  );

  it.effect(
    "rejects a divergent same-tree branch because every new Submission requires Change Base ancestry",
    () =>
      Effect.gen(function* () {
        const repo = yield* captureReadyRepoCopy();
        const baseTree = git(repo, "rev-parse", "refs/remotes/origin/main^{tree}");
        const movedTarget = git(
          repo,
          "commit-tree",
          baseTree,
          "-p",
          "refs/remotes/origin/main",
          "-m",
          "move base",
        );
        git(repo, "update-ref", "refs/remotes/origin/main", movedTarget);
        const sameTreeHead = git(repo, "commit-tree", baseTree, "-p", "HEAD", "-m", "same tree");
        git(repo, "reset", "--hard", sameTreeHead);

        const captured = yield* captureLocalCandidate({ cwd: repo, now });

        expect(captured).toEqual({
          ok: false,
          code: "change_base_not_ancestor",
          branchRef: "refs/heads/feature",
          headSha: sameTreeHead,
          changeBaseRef: "refs/remotes/origin/main",
          changeBaseSha: movedTarget,
        });
      }),
  );

  it.effect("accepts a Repository Branch rebased onto the fetched Change Base", () =>
    Effect.gen(function* () {
      const repo = yield* captureReadyRepoCopy();
      const tree = git(repo, "rev-parse", "refs/remotes/origin/main^{tree}");
      const movedTarget = git(
        repo,
        "commit-tree",
        tree,
        "-p",
        "refs/remotes/origin/main",
        "-m",
        "move base",
      );
      git(repo, "update-ref", "refs/remotes/origin/main", movedTarget);
      git(repo, "rebase", "refs/remotes/origin/main");

      const captured = yield* captureLocalCandidate({ cwd: repo, now });

      expect(captured).toMatchObject({
        ok: true,
        changeBaseSha: movedTarget,
        headSha: git(repo, "rev-parse", "HEAD"),
      });
    }),
  );

  it.effect("reports tracked-tree equality against the current Change Base", () =>
    Effect.gen(function* () {
      const repo = yield* captureReadyRepoCopy();
      const startingCommit = git(repo, "rev-parse", "refs/heads/main");
      const changed = yield* captureLocalCandidate({ cwd: repo, now });
      if (!changed.ok) return;

      git(repo, "reset", "--hard", startingCommit);
      const reverted = yield* captureLocalCandidate({
        cwd: repo,
        changeId: changed.changeId,
        now: "2026-07-12T10:05:00.000Z",
      });

      expect(reverted).toMatchObject({
        ok: true,
        changeId: changed.changeId,
        changeBaseSha: startingCommit,
        headSha: startingCommit,
        trackedTreeMatchesChangeBase: true,
      });
    }),
  );

  it.effect("reports dirty, detached, and unborn local Git workspaces", () =>
    Effect.gen(function* () {
      const dirty = committedRepoCopy();
      writeFileSync(join(dirty, "untracked.txt"), "dirty\n");
      expect(yield* localCandidateCaptureGit.readWorkspace(dirty)).toEqual({
        ok: false,
        code: "dirty_work",
      });
      expect(readRepositoryBranchHead(dirty, "refs/heads/main")).toEqual({
        ok: true,
        headSha: git(dirty, "rev-parse", "HEAD"),
      });
      expect(yield* localCandidateCaptureGit.trackedTreeMatches(dirty, "missing-commit")).toBe(
        undefined,
      );

      const detached = committedRepoCopy();
      git(detached, "checkout", "--detach", "HEAD");
      expect(yield* localCandidateCaptureGit.readWorkspace(detached)).toEqual({
        ok: false,
        code: "detached_head",
      });

      const unborn = createGitRepo();
      git(unborn, "checkout", "-b", "unborn");
      expect(yield* localCandidateCaptureGit.readWorkspace(unborn)).toEqual({
        ok: false,
        code: "unborn_branch",
      });
    }),
  );

  it.effect("reads reflog renames and linked-worktree repository identity", () =>
    Effect.gen(function* () {
      const repo = committedRepoCopy();
      git(repo, "branch", "-m", "renamed");
      const renamed = yield* localCandidateCaptureGit.readWorkspace(repo);
      expect(renamed).toMatchObject({
        ok: true,
        facts: { branchRef: "refs/heads/renamed", renameFromRef: "refs/heads/main" },
      });

      const linked = join(createTestWorkspace(), "linked");
      git(repo, "worktree", "add", "-b", "linked", linked, "HEAD");
      const linkedFacts = yield* localCandidateCaptureGit.readWorkspace(linked);
      expect(linkedFacts).toMatchObject({
        ok: true,
        facts: {
          repositoryCommonDirectory: commonDirectory(repo),
          primaryRoot: repo,
          branchRef: "refs/heads/linked",
        },
      });
    }),
  );
});

const captureReadyRepo = (workspace?: string): string => {
  const root = createInitializedRepo(workspace);
  configureGit(root);
  git(root, "checkout", "-b", "main");
  writeFileSync(join(root, "tracked.txt"), "main\n");
  git(root, "add", "tracked.txt", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(root, "checkout", "-b", "feature");
  writeFileSync(join(root, "tracked.txt"), "feature\n");
  git(root, "commit", "-am", "feature");
  return root;
};

const committedRepo = (workspace?: string): string => {
  const root = createGitRepo(workspace);
  configureGit(root);
  git(root, "checkout", "-b", "main");
  writeFileSync(join(root, "tracked.txt"), "tracked\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "initial");
  return root;
};

const configureGit = (root: string): void => {
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
};

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

const commonDirectory = (root: string): string =>
  git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
