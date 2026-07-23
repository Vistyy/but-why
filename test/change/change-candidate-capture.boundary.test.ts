import { spawnSync } from "node:child_process";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import { localChangeCandidateCaptureGit } from "../../src/changeCandidateCapture/localGitCandidate.js";
import { createGitRepo } from "../support/by-cli.js";
import { captureLocalCandidate } from "../support/changeCandidateCapture.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const now = "2026-07-12T10:00:00.000Z";
let committedRepoTemplate: string;

beforeAll(() => {
  committedRepoTemplate = acquireTestWorkspace();
  committedRepo(committedRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(committedRepoTemplate);
});

const committedRepoCopy = (): string => {
  const root = createTestWorkspace();
  cpSync(committedRepoTemplate, root, { recursive: true });
  return root;
};

describe("Change Candidate capture boundaries", () => {
  it.effect("captures committed work against the recorded remote default", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const mainSha = git(repo, "rev-parse", "refs/heads/main");
      const headSha = git(repo, "rev-parse", "HEAD");

      const result = yield* captureLocalCandidate({ cwd: repo, now });

      expect(result).toEqual({
        ok: true,
        changeId: expect.any(String),
        candidateId: expect.any(String),
        branchRef: "refs/heads/feature",
        selectedBaseRef: "refs/heads/main",
        baseSource: "remote_default",
        resolvedTargetSha: mainSha,
        comparisonBaseSha: mainSha,
        headSha,
      });

      const tree = git(repo, "rev-parse", "refs/heads/main^{tree}");
      const movedTarget = git(
        repo,
        "commit-tree",
        tree,
        "-p",
        "refs/heads/main",
        "-m",
        "move base",
      );
      git(repo, "update-ref", "refs/heads/main", movedTarget);
      expect(yield* captureLocalCandidate({ cwd: repo, now: "2026-07-12T11:00:00.000Z" })).toEqual({
        ok: false,
        code: "candidate_provenance_conflict",
      });
    }),
  );

  it.effect("reports dirty, detached, and unborn local Git workspaces", () =>
    Effect.gen(function* () {
      const dirty = committedRepoCopy();
      writeFileSync(join(dirty, "untracked.txt"), "dirty\n");
      expect(yield* localChangeCandidateCaptureGit.readWorkspace(dirty)).toEqual({
        ok: false,
        code: "dirty_work",
      });

      const detached = committedRepoCopy();
      git(detached, "checkout", "--detach", "HEAD");
      expect(yield* localChangeCandidateCaptureGit.readWorkspace(detached)).toEqual({
        ok: false,
        code: "detached_head",
      });

      const unborn = createGitRepo();
      git(unborn, "checkout", "-b", "unborn");
      expect(yield* localChangeCandidateCaptureGit.readWorkspace(unborn)).toEqual({
        ok: false,
        code: "unborn_branch",
      });
    }),
  );

  it.effect("reads reflog renames and linked-worktree repository identity", () =>
    Effect.gen(function* () {
      const repo = committedRepoCopy();
      git(repo, "branch", "-m", "renamed");
      const renamed = yield* localChangeCandidateCaptureGit.readWorkspace(repo);
      expect(renamed).toMatchObject({
        ok: true,
        facts: { branchRef: "refs/heads/renamed", renameFromRef: "refs/heads/main" },
      });

      const linked = join(createTestWorkspace(), "linked");
      git(repo, "worktree", "add", "-b", "linked", linked, "HEAD");
      const linkedFacts = yield* localChangeCandidateCaptureGit.readWorkspace(linked);
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

const captureReadyRepo = (): string => {
  const root = createInitializedRepo();
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
