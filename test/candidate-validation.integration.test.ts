import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import { openCandidateValidation } from "../src/candidateValidation/validateCandidate.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { cleanupTempRoots, createGitRepo, runByInProcessArgs as runBy } from "./support/by-cli.js";

const now = "2026-07-15T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("Candidate validation", () => {
  it("runs every Check in one disposable workspace and reuses identical passing policy evidence", async () => {
    const repo = candidateReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const validation = openCandidateValidation({
      localRepositoryRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
    });
    const policy = {
      sandboxMode: "none" as const,
      checks: [
        { id: "fails", command: "exit 1", timeoutSeconds: 1 },
        { id: "later", command: "git rev-parse --verify HEAD", timeoutSeconds: 1 },
      ],
      copyFiles: [],
    };

    const first = await Effect.runPromise(
      validation.validateCandidate({
        candidateId: captured.candidateId,
        headSha: captured.headSha,
        policy,
        now,
      }),
    );
    expect(first).toMatchObject({ ok: true, reused: false, outcome: "blocked" });
    if (!first.ok) return;
    expect(validation.listRounds(first.validationRunId)).toHaveLength(2);
    expect(validation.listFindings(first.validationRunId)).toHaveLength(1);

    const passingPolicy = {
      ...policy,
      checks: [{ id: "passes", command: "git rev-parse --verify HEAD", timeoutSeconds: 1 }],
    };
    const passing = await Effect.runPromise(
      validation.validateCandidate({
        candidateId: captured.candidateId,
        headSha: captured.headSha,
        policy: passingPolicy,
        now,
      }),
    );
    expect(passing).toMatchObject({ ok: true, reused: false, outcome: "passed" });
    if (!passing.ok) return;
    expect(validation.listArtifacts(passing.validationRunId)).toContainEqual(
      expect.objectContaining({ truncated: false, originalBytes: expect.any(Number) }),
    );

    await expect(
      Effect.runPromise(
        validation.validateCandidate({
          candidateId: captured.candidateId,
          headSha: captured.headSha,
          policy: passingPolicy,
          now,
        }),
      ),
    ).resolves.toEqual({
      ok: true,
      reused: true,
      validationRunId: passing.validationRunId,
      outcome: "passed",
    });
  });

  it("stops Checks after a failed Prepare", async () => {
    const repo = candidateReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const validation = openCandidateValidation({
      localRepositoryRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
    });

    const result = await Effect.runPromise(
      validation.validateCandidate({
        candidateId: captured.candidateId,
        headSha: captured.headSha,
        policy: {
          sandboxMode: "none",
          prepare: { command: "exit 1", timeoutSeconds: 1 },
          checks: [{ id: "skipped", command: "exit 1", timeoutSeconds: 1 }],
          copyFiles: [],
        },
        now,
      }),
    );

    expect(result).toMatchObject({ ok: true, outcome: "blocked" });
    if (!result.ok) return;
    expect(validation.listRounds(result.validationRunId)).toEqual([
      { producer: "prepare", status: "failed" },
    ]);
  });

  it("fails tooling when a Check changes the Candidate worktree head", async () => {
    const repo = candidateReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const validation = openCandidateValidation({
      localRepositoryRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
    });

    await expect(
      Effect.runPromise(
        validation.validateCandidate({
          candidateId: captured.candidateId,
          headSha: captured.headSha,
          policy: {
            sandboxMode: "none",
            checks: [
              {
                id: "mutates-worktree",
                command: "printf changed > .but-why/config.json",
                timeoutSeconds: 1,
              },
            ],
            copyFiles: [],
          },
          now,
        }),
      ),
    ).resolves.toMatchObject({ ok: false, outcome: "tooling_failed" });
  });

  it("copies a regular local validation file without changing Candidate identity", async () => {
    const repo = candidateReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    writeFileSync(join(repo, ".validation-env"), "enabled=true\n");

    const validation = openCandidateValidation({
      localRepositoryRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
    });
    await expect(
      Effect.runPromise(
        validation.validateCandidate({
          candidateId: captured.candidateId,
          headSha: captured.headSha,
          policy: {
            sandboxMode: "none",
            checks: [{ id: "reads-env", command: "test -f .validation-env", timeoutSeconds: 1 }],
            copyFiles: [".validation-env"],
          },
          now,
        }),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "passed" });
    expect(git(repo, "rev-parse", "HEAD")).toBe(captured.headSha);
  });
});

const candidateReadyRepo = (): string => {
  const root = createGitRepo();
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "checkout", "-b", "main");
  git(root, "commit", "--allow-empty", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
  git(root, "add", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "initialize but why");
  git(root, "checkout", "-b", "feature");
  git(root, "commit", "--allow-empty", "-m", "feature");
  return root;
};

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

const commonDirectory = (root: string): string =>
  git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");

const sqliteInput = (root: string) => ({
  statePath: join(commonDirectory(root), "but-why", "state.sqlite"),
  migrationTimestamp: () => now,
});
