import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import { openCandidateValidation } from "../src/candidateValidation/validateCandidate.js";
import { prepareStateDatabaseSession } from "../src/init/stateDatabase.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { cleanupTempRoots } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-07-15T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("Candidate validation", () => {
  it("runs every Check in one disposable workspace and reuses identical passing policy evidence", async () => {
    const repo = candidateReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const validation = openCandidateValidation({
      localRepositoryMainCheckoutRoot: repo,
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
      localRepositoryMainCheckoutRoot: repo,
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
      localRepositoryMainCheckoutRoot: repo,
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

  it("rejects a copied local validation file tracked by the Candidate", async () => {
    const repo = candidateReadyRepo();
    writeFileSync(join(repo, ".validation-env"), "candidate=true\n");
    git(repo, "add", ".validation-env");
    git(repo, "commit", "-m", "track validation environment");
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    writeFileSync(join(repo, ".validation-env"), "local=true\n");

    const validation = openCandidateValidation({
      localRepositoryMainCheckoutRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
    });
    const result = await Effect.runPromise(
      validation.validateCandidate({
        candidateId: captured.candidateId,
        headSha: captured.headSha,
        policy: {
          sandboxMode: "none",
          checks: [{ id: "must-not-run", command: "exit 0", timeoutSeconds: 1 }],
          copyFiles: [".validation-env"],
        },
        now,
      }),
    );

    expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
    expect(validation.listRounds(result.validationRunId)).toEqual([]);
  });

  it("copies a regular local validation file from the main checkout without changing Candidate identity", async () => {
    const mainCheckout = candidateReadyRepo();
    const candidateCheckout = join(commonDirectory(mainCheckout), "candidate-worktree");
    git(mainCheckout, "worktree", "add", "-q", "-b", "linked-candidate", candidateCheckout, "HEAD");
    const captured = captureLocalCandidate({ cwd: candidateCheckout, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    writeFileSync(join(mainCheckout, ".validation-env"), "source=main\n");
    writeFileSync(join(candidateCheckout, ".validation-env"), "source=candidate\n");

    const validation = openCandidateValidation({
      localRepositoryMainCheckoutRoot: mainCheckout,
      artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(mainCheckout)),
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
                id: "reads-main-env",
                command: "grep -qx 'source=main' .validation-env",
                timeoutSeconds: 1,
              },
            ],
            copyFiles: [".validation-env"],
          },
          now,
        }),
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "passed" });
    expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
  });
});

const candidateReadyRepo = (): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "checkout", "-b", "main");
  git(root, "commit", "--allow-empty", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
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

const sqliteInput = (root: string) =>
  prepareStateDatabaseSession({
    statePath: join(commonDirectory(root), "but-why", "state.sqlite"),
    migrationTimestamp: () => now,
  });
