import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryIdentityConflict } from "../src/repositoryStorageError.js";
import { captureLocalCandidate } from "./support/changeCandidateCapture.js";
import { RepositorySql } from "../src/sqlite/repositorySql.js";
import { createGitRepo } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { withTestRepository } from "./support/repository.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-07-12T10:00:00.000Z";

describe("automatic Change and Candidate capture", () => {
  it.effect("captures clean committed work against the locally recorded remote default", () =>
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
    }),
  );

  it.effect("reuses the Change and exact Candidate, then keeps the saved base for new work", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const first = yield* captureLocalCandidate({ cwd: repo, now });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      expect(yield* captureLocalCandidate({ cwd: repo, now: "2026-07-12T11:00:00.000Z" })).toEqual({
        ...first,
        baseSource: "saved_change",
      });

      writeFileSync(join(repo, "tracked.txt"), "more feature work\n");
      git(repo, "commit", "-am", "more work");
      const next = yield* captureLocalCandidate({ cwd: repo, now: "2026-07-12T12:00:00.000Z" });
      expect(next).toMatchObject({
        ok: true,
        changeId: first.changeId,
        candidateId: expect.not.stringMatching(first.candidateId),
        baseSource: "saved_change",
        selectedBaseRef: "refs/heads/main",
      });
      expect(
        yield* captureLocalCandidate({
          cwd: repo,
          now,
          baseRef: "refs/heads/other",
        }),
      ).toEqual({ ok: false, code: "base_ref_conflict" });
    }),
  );

  it.effect("rejects unsafe worktree states before creating durable history", () =>
    Effect.gen(function* () {
      const dirty = captureReadyRepo();
      writeFileSync(join(dirty, "untracked.txt"), "dirty\n");
      expect(yield* captureLocalCandidate({ cwd: dirty, now })).toEqual({
        ok: false,
        code: "dirty_work",
      });
      expect(
        yield* readChangeByBranch(dirty, commonDirectory(dirty), "refs/heads/feature"),
      ).toBeUndefined();

      const detached = captureReadyRepo();
      git(detached, "checkout", "--detach", "HEAD");
      expect(yield* captureLocalCandidate({ cwd: detached, now })).toEqual({
        ok: false,
        code: "detached_head",
      });

      const unborn = createGitRepo();
      git(unborn, "checkout", "-b", "unborn");
      expect(yield* captureLocalCandidate({ cwd: unborn, now })).toEqual({
        ok: false,
        code: "unborn_branch",
      });
    }),
  );

  it.effect(
    "requires one recorded remote default with an available full local base",
    () =>
      Effect.gen(function* () {
        const missing = captureReadyRepo();
        git(missing, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
        expect(yield* captureLocalCandidate({ cwd: missing, now })).toEqual({
          ok: false,
          code: "missing_remote_default",
        });

        const ambiguous = captureReadyRepo();
        git(ambiguous, "branch", "release", "main");
        git(ambiguous, "remote", "add", "upstream", "https://example.com/upstream.git");
        git(ambiguous, "update-ref", "refs/remotes/upstream/release", "refs/heads/release");
        git(
          ambiguous,
          "symbolic-ref",
          "refs/remotes/upstream/HEAD",
          "refs/remotes/upstream/release",
        );
        expect(yield* captureLocalCandidate({ cwd: ambiguous, now })).toEqual({
          ok: false,
          code: "ambiguous_remote_default",
        });

        const unavailable = captureReadyRepo();
        git(unavailable, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/missing");
        expect(yield* captureLocalCandidate({ cwd: unavailable, now })).toEqual({
          ok: false,
          code: "local_base_unavailable",
        });
        expect(yield* captureLocalCandidate({ cwd: unavailable, now, baseRef: "main" })).toEqual({
          ok: false,
          code: "invalid_base_ref",
        });

        const slashRemote = captureReadyRepo();
        git(slashRemote, "remote", "rename", "origin", "team/origin");
        expect(yield* captureLocalCandidate({ cwd: slashRemote, now })).toMatchObject({
          ok: true,
          selectedBaseRef: "refs/heads/main",
          baseSource: "remote_default",
        });
      }),
    15_000,
  );

  it.effect("saves a caller-selected full local base on the first Candidate", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      git(repo, "branch", "release", "main");

      const captured = yield* captureLocalCandidate({
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
      expect(yield* readChange(repo, captured.changeId)).toMatchObject({
        baseRef: "refs/heads/release",
      });
    }),
  );

  it.effect("rejects closed, foreign, and occupied Change bindings", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const feature = yield* captureLocalCandidate({ cwd: repo, now });
      expect(feature.ok).toBe(true);
      if (!feature.ok) return;

      const foreign = yield* createStoredChange(
        repo,
        "/different/repository/.git",
        "refs/heads/foreign",
      );
      expect(yield* captureLocalCandidate({ cwd: repo, now, changeId: foreign.id })).toEqual({
        ok: false,
        code: "change_from_different_repository",
      });

      git(repo, "checkout", "-b", "occupied", "main");
      writeFileSync(join(repo, "occupied.txt"), "occupied\n");
      git(repo, "add", "occupied.txt");
      git(repo, "commit", "-m", "occupied");
      const occupied = yield* captureLocalCandidate({ cwd: repo, now });
      expect(occupied.ok).toBe(true);
      expect(
        yield* captureLocalCandidate({
          cwd: repo,
          now,
          changeId: feature.changeId,
          allowRebind: true,
        }),
      ).toEqual({ ok: false, code: "destination_branch_has_history" });

      yield* closeStoredChange(repo, occupied.ok ? occupied.changeId : "missing");
      expect(yield* captureLocalCandidate({ cwd: repo, now })).toEqual({
        ok: false,
        code: "change_closed",
      });
    }),
  );

  it.effect("requires explicit authorization to move a supplied Change", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const captured = yield* captureLocalCandidate({ cwd: repo, now });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      git(repo, "checkout", "-b", "other", "main");
      writeFileSync(join(repo, "other.txt"), "other\n");
      git(repo, "add", "other.txt");
      git(repo, "commit", "-m", "other");

      expect(yield* captureLocalCandidate({ cwd: repo, now, changeId: captured.changeId })).toEqual(
        {
          ok: false,
          code: "change_rebind_not_authorized",
        },
      );
      expect(yield* captureLocalCandidate({ cwd: repo, now, allowRebind: true })).toEqual({
        ok: false,
        code: "rebind_requires_change_id",
      });
      expect(
        yield* captureLocalCandidate({
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
    }),
  );

  it.effect("rejects explicit rebind when Git proves the branch came from another Change", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const feature = yield* captureLocalCandidate({ cwd: repo, now });
      expect(feature.ok).toBe(true);
      git(repo, "checkout", "-b", "other", "main");
      writeFileSync(join(repo, "other.txt"), "other\n");
      git(repo, "add", "other.txt");
      git(repo, "commit", "-m", "other");
      const other = yield* captureLocalCandidate({ cwd: repo, now });
      expect(other.ok).toBe(true);
      if (!other.ok) return;
      git(repo, "checkout", "feature");
      git(repo, "branch", "-m", "renamed");

      expect(
        yield* captureLocalCandidate({
          cwd: repo,
          now,
          changeId: other.changeId,
          allowRebind: true,
        }),
      ).toEqual({ ok: false, code: "conflicting_branch_facts" });
    }),
  );

  it.effect("automatically follows only the exact current-branch reflog rename", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const captured = yield* captureLocalCandidate({ cwd: repo, now });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;

      git(repo, "branch", "-m", "renamed");
      writeFileSync(join(repo, "after-rename.txt"), "after rename\n");
      git(repo, "add", "after-rename.txt");
      git(repo, "commit", "-m", "work after rename");
      expect(
        yield* captureLocalCandidate({ cwd: repo, now: "2026-07-12T11:00:00.000Z" }),
      ).toMatchObject({
        ok: true,
        changeId: captured.changeId,
        branchRef: "refs/heads/renamed",
        baseSource: "saved_change",
      });
    }),
  );

  it.effect("rejects a proven rename when the destination has any Change history", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const source = yield* captureLocalCandidate({ cwd: repo, now });
      expect(source.ok).toBe(true);
      if (!source.ok) return;

      git(repo, "checkout", "-b", "occupied", "main");
      writeFileSync(join(repo, "occupied.txt"), "occupied\n");
      git(repo, "add", "occupied.txt");
      git(repo, "commit", "-m", "occupied");
      expect(yield* captureLocalCandidate({ cwd: repo, now })).toMatchObject({ ok: true });
      git(repo, "checkout", "feature");
      git(repo, "branch", "-D", "occupied");
      git(repo, "branch", "-m", "occupied");

      expect(yield* captureLocalCandidate({ cwd: repo, now })).toEqual({
        ok: false,
        code: "destination_branch_has_history",
      });
      expect(yield* readChange(repo, source.changeId)).toMatchObject({
        branchRef: "refs/heads/feature",
      });
    }),
  );

  it.effect("shares repository identity and durable capture history across linked worktrees", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const linked = join(createTestWorkspace(), "linked");
      git(repo, "worktree", "add", "-b", "linked-feature", linked, "main");
      writeFileSync(join(linked, "linked.txt"), "linked\n");
      git(linked, "add", "linked.txt");
      git(linked, "commit", "-m", "linked work");

      const captured = yield* captureLocalCandidate({ cwd: linked, now });
      expect(captured).toMatchObject({ ok: true, branchRef: "refs/heads/linked-feature" });
      if (!captured.ok) return;
      expect(yield* readChange(repo, captured.changeId)).toMatchObject({
        repositoryCommonDirectory: commonDirectory(repo),
        branchRef: "refs/heads/linked-feature",
      });
      expect(yield* readCandidate(repo, captured.candidateId)).toBeDefined();
      expect(existsSync(join(linked, ".but-why", "state.sqlite"))).toBe(false);
    }),
  );

  it.effect("rejects Candidate capture when shared state belongs to another repository", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      yield* withTestRepository(
        repo,
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "change repository identity",
            (sql) => sql`
            UPDATE shared_state_identity
            SET common_directory = ${"/other/.git"}
            WHERE id = 1
          `,
          );
        }),
      );

      const error = yield* captureLocalCandidate({ cwd: repo, now }).pipe(Effect.flip);
      expect(error).toBeInstanceOf(RepositoryIdentityConflict);
      expect(error).toMatchObject({
        expectedCommonDirectory: commonDirectory(repo),
        actualCommonDirectory: "/other/.git",
      });
    }),
  );

  it.effect("rolls back the whole capture when existing Candidate provenance conflicts", () =>
    Effect.gen(function* () {
      const repo = captureReadyRepo();
      const first = yield* captureLocalCandidate({ cwd: repo, now });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
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
      expect(yield* countCandidates(repo, first.changeId)).toBe(1);
      expect(yield* readChange(repo, first.changeId)).toMatchObject({
        branchRef: "refs/heads/feature",
        baseRef: "refs/heads/main",
      });
    }),
  );
});

const captureReadyRepo = (): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "checkout", "-b", "main");
  writeFileSync(join(root, "tracked.txt"), "main\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
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

const readChange = (root: string, changeId: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const rows = yield* repository.operation(
        "read Change fixture",
        (sql) => sql<{
          readonly id: string;
          readonly repositoryCommonDirectory: string;
          readonly branchRef: string;
          readonly baseRef: string | null;
        }>`
          SELECT
            id,
            repository_common_directory AS repositoryCommonDirectory,
            branch_ref AS branchRef,
            base_ref AS baseRef
          FROM changes
          WHERE id = ${changeId}
        `,
      );
      return rows[0];
    }),
  );

const readChangeByBranch = (root: string, repositoryCommonDirectory: string, branchRef: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const rows = yield* repository.operation(
        "read Change branch fixture",
        (sql) => sql`
        SELECT id
        FROM changes
        WHERE repository_common_directory = ${repositoryCommonDirectory}
          AND branch_ref = ${branchRef}
      `,
      );
      return rows[0];
    }),
  );

const createStoredChange = (root: string, repositoryCommonDirectory: string, branchRef: string) => {
  const id = randomUUID();
  return withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Change fixture",
        (sql) => sql`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, task_id, state,
          close_reason, created_at, updated_at, closed_at
        ) VALUES (
          ${id}, ${repositoryCommonDirectory}, ${branchRef}, NULL, 'open',
          NULL, ${now}, ${now}, NULL
        )
      `,
      );
      return { id };
    }),
  );
};

const closeStoredChange = (root: string, changeId: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "close Change fixture",
        (sql) => sql`
        UPDATE changes
        SET state = 'closed', close_reason = 'completed', closed_at = ${now}, updated_at = ${now}
        WHERE id = ${changeId}
      `,
      );
    }),
  );

const readCandidate = (root: string, candidateId: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const rows = yield* repository.operation(
        "read Candidate fixture",
        (sql) => sql`
        SELECT id FROM candidates WHERE id = ${candidateId}
      `,
      );
      return rows[0];
    }),
  );

const countCandidates = (root: string, changeId: string) =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const rows = yield* repository.operation(
        "count Candidate fixtures",
        (sql) => sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM candidates WHERE change_id = ${changeId}
        `,
      );
      return rows[0]?.count ?? 0;
    }),
  );

const commonDirectory = (root: string): string =>
  git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
