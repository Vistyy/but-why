import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import {
  cleanupTempRoots,
  createGitRepo,
  createTempRoot,
  runByInProcessArgs as runBy,
} from "./support/by-cli.js";

const now = "2026-07-12T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("automatic Change and Candidate capture", () => {
  it("captures clean committed work against the locally recorded remote default", () => {
    const repo = captureReadyRepo();
    const mainSha = git(repo, "rev-parse", "refs/heads/main");
    const headSha = git(repo, "rev-parse", "HEAD");

    const result = captureLocalCandidate({ cwd: repo, now });

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
  });

  it("reuses the Change and exact Candidate, then keeps the saved base for new work", () => {
    const repo = captureReadyRepo();
    const first = captureLocalCandidate({ cwd: repo, now });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(captureLocalCandidate({ cwd: repo, now: "2026-07-12T11:00:00.000Z" })).toEqual({
      ...first,
      baseSource: "saved_change",
    });

    writeFileSync(join(repo, "tracked.txt"), "more feature work\n");
    git(repo, "commit", "-am", "more work");
    const next = captureLocalCandidate({ cwd: repo, now: "2026-07-12T12:00:00.000Z" });
    expect(next).toMatchObject({
      ok: true,
      changeId: first.changeId,
      candidateId: expect.not.stringMatching(first.candidateId),
      baseSource: "saved_change",
      selectedBaseRef: "refs/heads/main",
    });
    expect(
      captureLocalCandidate({
        cwd: repo,
        now,
        baseRef: "refs/heads/other",
      }),
    ).toEqual({ ok: false, code: "base_ref_conflict" });
  });

  it("rejects unsafe worktree states before creating durable history", () => {
    const dirty = captureReadyRepo();
    writeFileSync(join(dirty, "untracked.txt"), "dirty\n");
    expect(captureLocalCandidate({ cwd: dirty, now })).toEqual({ ok: false, code: "dirty_work" });
    expect(
      changeStore(dirty).getChangeByRepositoryBranch(commonDirectory(dirty), "refs/heads/feature"),
    ).toBeUndefined();

    const detached = captureReadyRepo();
    git(detached, "checkout", "--detach", "HEAD");
    expect(captureLocalCandidate({ cwd: detached, now })).toEqual({
      ok: false,
      code: "detached_head",
    });

    const unborn = createGitRepo();
    git(unborn, "checkout", "-b", "unborn");
    expect(captureLocalCandidate({ cwd: unborn, now })).toEqual({
      ok: false,
      code: "unborn_branch",
    });
  });

  it("requires one recorded remote default with an available full local base", () => {
    const missing = captureReadyRepo();
    git(missing, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
    expect(captureLocalCandidate({ cwd: missing, now })).toEqual({
      ok: false,
      code: "missing_remote_default",
    });

    const ambiguous = captureReadyRepo();
    git(ambiguous, "branch", "release", "main");
    git(ambiguous, "remote", "add", "upstream", "https://example.com/upstream.git");
    git(ambiguous, "update-ref", "refs/remotes/upstream/release", "refs/heads/release");
    git(ambiguous, "symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/release");
    expect(captureLocalCandidate({ cwd: ambiguous, now })).toEqual({
      ok: false,
      code: "ambiguous_remote_default",
    });

    const unavailable = captureReadyRepo();
    git(unavailable, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/missing");
    expect(captureLocalCandidate({ cwd: unavailable, now })).toEqual({
      ok: false,
      code: "local_base_unavailable",
    });
    expect(captureLocalCandidate({ cwd: unavailable, now, baseRef: "main" })).toEqual({
      ok: false,
      code: "invalid_base_ref",
    });

    const slashRemote = captureReadyRepo();
    git(slashRemote, "remote", "rename", "origin", "team/origin");
    expect(captureLocalCandidate({ cwd: slashRemote, now })).toMatchObject({
      ok: true,
      selectedBaseRef: "refs/heads/main",
      baseSource: "remote_default",
    });
  });

  it("saves a caller-selected full local base on the first Candidate", () => {
    const repo = captureReadyRepo();
    git(repo, "branch", "release", "main");

    const captured = captureLocalCandidate({
      cwd: repo,
      now,
      baseRef: "refs/heads/release",
    });

    expect(captured).toMatchObject({
      ok: true,
      selectedBaseRef: "refs/heads/release",
      baseSource: "caller",
    });
    if (!captured.ok) return;
    expect(changeStore(repo).getChangeById(captured.changeId)).toMatchObject({
      baseRef: "refs/heads/release",
    });
  });

  it("rejects closed, foreign, and occupied Change bindings", () => {
    const repo = captureReadyRepo();
    const feature = captureLocalCandidate({ cwd: repo, now });
    expect(feature.ok).toBe(true);
    if (!feature.ok) return;

    const foreign = changeStore(repo).createChange({
      repositoryCommonDirectory: "/different/repository/.git",
      branchRef: "refs/heads/foreign",
      now,
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(captureLocalCandidate({ cwd: repo, now, changeId: foreign.change.id })).toEqual({
      ok: false,
      code: "change_from_different_repository",
    });

    git(repo, "checkout", "-b", "occupied", "main");
    writeFileSync(join(repo, "occupied.txt"), "occupied\n");
    git(repo, "add", "occupied.txt");
    git(repo, "commit", "-m", "occupied");
    const occupied = captureLocalCandidate({ cwd: repo, now });
    expect(occupied.ok).toBe(true);
    expect(
      captureLocalCandidate({
        cwd: repo,
        now,
        changeId: feature.changeId,
        allowRebind: true,
      }),
    ).toEqual({ ok: false, code: "destination_branch_has_history" });

    expect(
      changeStore(repo).closeChange({
        changeId: occupied.ok ? occupied.changeId : "missing",
        reason: "completed",
        now,
      }).ok,
    ).toBe(true);
    expect(captureLocalCandidate({ cwd: repo, now })).toEqual({
      ok: false,
      code: "change_closed",
    });
  });

  it("requires explicit authorization to move a supplied Change", () => {
    const repo = captureReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    git(repo, "checkout", "-b", "other", "main");
    writeFileSync(join(repo, "other.txt"), "other\n");
    git(repo, "add", "other.txt");
    git(repo, "commit", "-m", "other");

    expect(captureLocalCandidate({ cwd: repo, now, changeId: captured.changeId })).toEqual({
      ok: false,
      code: "change_rebind_not_authorized",
    });
    expect(captureLocalCandidate({ cwd: repo, now, allowRebind: true })).toEqual({
      ok: false,
      code: "rebind_requires_change_id",
    });
    expect(
      captureLocalCandidate({
        cwd: repo,
        now,
        changeId: captured.changeId,
        allowRebind: true,
      }),
    ).toMatchObject({
      ok: true,
      changeId: captured.changeId,
      branchRef: "refs/heads/other",
    });
  });

  it("rejects explicit rebind when Git proves the branch came from another Change", () => {
    const repo = captureReadyRepo();
    const feature = captureLocalCandidate({ cwd: repo, now });
    expect(feature.ok).toBe(true);
    git(repo, "checkout", "-b", "other", "main");
    writeFileSync(join(repo, "other.txt"), "other\n");
    git(repo, "add", "other.txt");
    git(repo, "commit", "-m", "other");
    const other = captureLocalCandidate({ cwd: repo, now });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    git(repo, "checkout", "feature");
    git(repo, "branch", "-m", "renamed");

    expect(
      captureLocalCandidate({
        cwd: repo,
        now,
        changeId: other.changeId,
        allowRebind: true,
      }),
    ).toEqual({ ok: false, code: "conflicting_branch_facts" });
  });

  it("automatically follows only the exact current-branch reflog rename", () => {
    const repo = captureReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    git(repo, "branch", "-m", "renamed");
    writeFileSync(join(repo, "after-rename.txt"), "after rename\n");
    git(repo, "add", "after-rename.txt");
    git(repo, "commit", "-m", "work after rename");
    expect(captureLocalCandidate({ cwd: repo, now: "2026-07-12T11:00:00.000Z" })).toMatchObject({
      ok: true,
      changeId: captured.changeId,
      branchRef: "refs/heads/renamed",
      baseSource: "saved_change",
    });
  });

  it("rejects a proven rename when the destination has any Change history", () => {
    const repo = captureReadyRepo();
    const source = captureLocalCandidate({ cwd: repo, now });
    expect(source.ok).toBe(true);
    if (!source.ok) return;

    git(repo, "checkout", "-b", "occupied", "main");
    writeFileSync(join(repo, "occupied.txt"), "occupied\n");
    git(repo, "add", "occupied.txt");
    git(repo, "commit", "-m", "occupied");
    expect(captureLocalCandidate({ cwd: repo, now })).toMatchObject({ ok: true });
    git(repo, "checkout", "feature");
    git(repo, "branch", "-D", "occupied");
    git(repo, "branch", "-m", "occupied");

    expect(captureLocalCandidate({ cwd: repo, now })).toEqual({
      ok: false,
      code: "destination_branch_has_history",
    });
    expect(changeStore(repo).getChangeById(source.changeId)).toMatchObject({
      branchRef: "refs/heads/feature",
    });
  });

  it("shares repository identity and durable capture history across linked worktrees", () => {
    const repo = captureReadyRepo();
    const linked = join(createTempRoot(), "linked");
    git(repo, "worktree", "add", "-b", "linked-feature", linked, "main");
    writeFileSync(join(linked, "linked.txt"), "linked\n");
    git(linked, "add", "linked.txt");
    git(linked, "commit", "-m", "linked work");

    const captured = captureLocalCandidate({ cwd: linked, now });
    expect(captured).toMatchObject({ ok: true, branchRef: "refs/heads/linked-feature" });
    if (!captured.ok) return;
    expect(changeStore(repo).getChangeById(captured.changeId)).toMatchObject({
      repositoryCommonDirectory: commonDirectory(repo),
      branchRef: "refs/heads/linked-feature",
    });
    expect(candidateStore(repo).getCandidateById(captured.candidateId)).toBeDefined();
    expect(existsSync(join(linked, ".but-why", "state.sqlite"))).toBe(false);
  });

  it("rejects Candidate capture when shared state belongs to another repository", () => {
    const repo = captureReadyRepo();
    const database = new DatabaseSync(join(commonDirectory(repo), "but-why", "state.sqlite"));
    database
      .prepare("UPDATE shared_state_identity SET common_directory = ? WHERE id = 1")
      .run("/other/.git");
    database.close();

    expect(captureLocalCandidate({ cwd: repo, now })).toEqual({
      ok: false,
      code: "shared_state_identity_conflict",
    });
  });

  it("rolls back the whole capture when existing Candidate provenance conflicts", () => {
    const repo = captureReadyRepo();
    const first = captureLocalCandidate({ cwd: repo, now });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const tree = git(repo, "rev-parse", "refs/heads/main^{tree}");
    const movedTarget = git(repo, "commit-tree", tree, "-p", "refs/heads/main", "-m", "move base");
    git(repo, "update-ref", "refs/heads/main", movedTarget);

    expect(captureLocalCandidate({ cwd: repo, now: "2026-07-12T11:00:00.000Z" })).toEqual({
      ok: false,
      code: "candidate_provenance_conflict",
    });
    expect(candidateStore(repo).listCandidatesForChange(first.changeId)).toHaveLength(1);
    expect(changeStore(repo).getChangeById(first.changeId)).toMatchObject({
      branchRef: "refs/heads/feature",
      baseRef: "refs/heads/main",
    });
  });
});

const captureReadyRepo = (): string => {
  const root = createGitRepo();
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "checkout", "-b", "main");
  writeFileSync(join(root, "tracked.txt"), "main\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
  git(root, "add", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "initialize but why");
  git(root, "checkout", "-b", "feature");
  writeFileSync(join(root, "tracked.txt"), "feature\n");
  git(root, "commit", "-am", "feature");
  return root;
};

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

const sqliteInput = (root: string) => ({
  statePath: join(commonDirectory(root), "but-why", "state.sqlite"),
  migrationTimestamp: () => now,
});

const changeStore = (root: string) => openSqliteChangeStore(sqliteInput(root));

const candidateStore = (root: string) => openSqliteCandidateStore(sqliteInput(root));

const commonDirectory = (root: string): string =>
  git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
