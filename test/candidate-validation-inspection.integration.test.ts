import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareStateDatabaseSession } from "../src/init/stateDatabase.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { cleanupTempRoots, runByInProcess } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-07-18T10:00:00.000Z";
const later = "2026-07-18T10:05:00.000Z";

const policy = {
  sandboxMode: "none",
  prepare: { command: "pnpm install", timeoutSeconds: 60 },
  checks: [
    { id: "types", command: "pnpm typecheck", timeoutSeconds: 30 },
    { id: "tests", command: "pnpm test", timeoutSeconds: 30 },
  ],
  copyFiles: [".env.test"],
};

afterEach(cleanupTempRoots);

describe("Candidate-owned Validation Run inspection", () => {
  it("shows the Candidate judgment and ordered evidence with bounded previews", () => {
    const fixture = candidateValidationFixture();
    const longContent = "x".repeat(1_200);

    fixture.runStore.recordPrepareRound({
      validationRunId: fixture.validationRunId,
      roundNumber: 1,
      roundStatus: "passed",
      phaseStatus: "passed",
      artifactRecords: [fixture.artifact("prepare", "prepare", "logs.txt", "prepare complete\n")],
      now,
    });
    fixture.runStore.recordCheckRound({
      validationRunId: fixture.validationRunId,
      producer: "types",
      roundNumber: 1,
      roundStatus: "failed",
      phaseStatus: "active",
      artifactRecords: [
        fixture.artifact("checks", "types", "logs.txt", "types failed\n"),
        fixture.artifact("checks", "types", "stdout.txt", longContent),
      ],
      finding: {
        id: `${fixture.validationRunId}-F1`,
        validationRunId: fixture.validationRunId,
        phase: "checks",
        producer: "types",
        title: "Check failed: types",
        description: "Configured check types exited with code 1.",
        severity: "high",
        evidence: "command: pnpm typecheck\nexitCode: 1",
        files: ["src/main.ts"],
        artifactRefs: [`artifact:${fixture.validationRunId}/checks/types/stdout.txt`],
      },
      now,
    });
    fixture.runStore.recordCheckRound({
      validationRunId: fixture.validationRunId,
      producer: "tests",
      roundNumber: 2,
      roundStatus: "passed",
      phaseStatus: "failed",
      artifactRecords: [fixture.artifact("checks", "tests", "stderr.txt", "")],
      now,
    });
    fixture.runStore.recordToolingFailure({
      validationRunId: fixture.validationRunId,
      errorKind: "validation_workspace_setup_failed",
      operationName: "cleanup_validation_worktree",
      errorMessage: "Could not remove worktree.",
      now: later,
    });
    fixture.runStore.complete({
      validationRunId: fixture.validationRunId,
      outcome: "tooling_failed",
      now: later,
    });

    const result = runByInProcess(fixture.root, [
      "validation-run",
      "show",
      fixture.validationRunId,
      "--output",
      "json",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      validationRun: {
        id: fixture.validationRunId,
        candidateId: fixture.candidateId,
        state: "complete",
        outcome: "tooling_failed",
        createdAt: now,
        updatedAt: later,
      },
      change: {
        id: fixture.changeId,
        branchRef: "refs/heads/feature",
        baseRef: "refs/remotes/origin/main",
        taskId: null,
        state: "open",
      },
      candidate: {
        id: fixture.candidateId,
        changeId: fixture.changeId,
        selectedBaseRef: "refs/remotes/origin/main",
        resolvedTargetSha: "target-sha",
        comparisonBaseSha: "base-sha",
        headSha: "head-sha",
        createdAt: now,
      },
      policy,
      phases: [
        {
          phase: "prepare",
          rounds: [
            {
              validationRunId: fixture.validationRunId,
              phase: "prepare",
              producer: "prepare",
              roundNumber: 1,
              status: "passed",
              createdAt: now,
            },
          ],
        },
        {
          phase: "checks",
          rounds: [
            {
              validationRunId: fixture.validationRunId,
              phase: "checks",
              producer: "types",
              roundNumber: 1,
              status: "failed",
              createdAt: now,
            },
            {
              validationRunId: fixture.validationRunId,
              phase: "checks",
              producer: "tests",
              roundNumber: 2,
              status: "passed",
              createdAt: now,
            },
          ],
        },
      ],
      findings: [
        {
          id: `${fixture.validationRunId}-F1`,
          validationRunId: fixture.validationRunId,
          phase: "checks",
          producer: "types",
          source: "checks/types",
          title: "Check failed: types",
          description: "Configured check types exited with code 1.",
          severity: "high",
          evidence: "command: pnpm typecheck\nexitCode: 1",
          files: ["src/main.ts"],
          artifactRefs: [`artifact:${fixture.validationRunId}/checks/types/stdout.txt`],
          createdAt: now,
          updatedAt: now,
        },
      ],
      toolingFailures: [
        {
          sequence: 1,
          validationRunId: fixture.validationRunId,
          errorKind: "validation_workspace_setup_failed",
          operationName: "cleanup_validation_worktree",
          errorMessage: "Could not remove worktree.",
          createdAt: later,
        },
      ],
      artifacts: [
        expect.objectContaining({
          ref: `artifact:${fixture.validationRunId}/prepare/prepare/logs.txt`,
          phase: "prepare",
          producer: "prepare",
          preview: {
            status: "available",
            content: "prepare complete\n",
            bytes: 17,
            storedBytes: 17,
            truncated: false,
            detailCommand: `by validation-run artifact ${fixture.validationRunId} artifact:${fixture.validationRunId}/prepare/prepare/logs.txt`,
          },
        }),
        expect.objectContaining({
          ref: `artifact:${fixture.validationRunId}/checks/tests/stderr.txt`,
          phase: "checks",
          producer: "tests",
        }),
        expect.objectContaining({
          ref: `artifact:${fixture.validationRunId}/checks/types/stdout.txt`,
          phase: "checks",
          producer: "types",
          preview: {
            status: "available",
            content: "x".repeat(1_000),
            bytes: 1_000,
            storedBytes: 1_200,
            truncated: true,
            detailCommand: `by validation-run artifact ${fixture.validationRunId} artifact:${fixture.validationRunId}/checks/types/stdout.txt`,
          },
        }),
        expect.objectContaining({
          ref: `artifact:${fixture.validationRunId}/checks/types/logs.txt`,
          phase: "checks",
          producer: "types",
        }),
      ],
    });

    const artifactRef = `artifact:${fixture.validationRunId}/checks/types/stdout.txt`;
    const detail = runByInProcess(fixture.root, [
      "validation-run",
      "artifact",
      fixture.validationRunId,
      artifactRef,
      "--output",
      "json",
    ]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toMatchObject({
      artifact: { ref: artifactRef, storedBytes: 1_200 },
      content: longContent,
    });
  });

  it("keeps empty evidence distinct from unavailable artifact content", () => {
    const empty = candidateValidationFixture();
    empty.runStore.complete({ validationRunId: empty.validationRunId, outcome: "passed", now });

    const emptyResult = runByInProcess(empty.root, [
      "validation-run",
      "show",
      empty.validationRunId,
      "--output",
      "json",
    ]);
    expect(emptyResult.status).toBe(0);
    expect(JSON.parse(emptyResult.stdout)).toMatchObject({
      phases: [
        { phase: "prepare", rounds: [] },
        { phase: "checks", rounds: [] },
      ],
      findings: [],
      toolingFailures: [],
      artifacts: [],
    });

    const unavailable = candidateValidationFixture();
    const missing = unavailable.artifact("checks", "types", "stdout.txt", "missing");
    unavailable.runStore.recordCheckRound({
      validationRunId: unavailable.validationRunId,
      producer: "types",
      roundNumber: 1,
      roundStatus: "passed",
      phaseStatus: "passed",
      artifactRecords: [missing],
      now,
    });
    rmSync(join(unavailable.artifactsRoot, missing.path));

    const unavailableResult = runByInProcess(unavailable.root, [
      "validation-run",
      "show",
      unavailable.validationRunId,
      "--output",
      "json",
    ]);
    expect(unavailableResult.status).toBe(0);
    expect(JSON.parse(unavailableResult.stdout).artifacts[0].preview).toEqual({
      status: "unavailable",
      reason: "content_unavailable",
      detailCommand: `by validation-run artifact ${unavailable.validationRunId} ${missing.ref}`,
    });
  });

  it("returns typed actionable errors for unknown Runs, Artifacts, and unavailable content", () => {
    const fixture = candidateValidationFixture();
    const missing = fixture.artifact("checks", "types", "stdout.txt", "missing");
    fixture.runStore.recordCheckRound({
      validationRunId: fixture.validationRunId,
      producer: "types",
      roundNumber: 1,
      roundStatus: "passed",
      phaseStatus: "passed",
      artifactRecords: [missing],
      now,
    });
    rmSync(join(fixture.artifactsRoot, missing.path));

    const unknownRun = runByInProcess(fixture.root, [
      "validation-run",
      "show",
      "missing-run",
      "--output",
      "json",
    ]);
    const unknownArtifact = runByInProcess(fixture.root, [
      "validation-run",
      "artifact",
      fixture.validationRunId,
      "missing-artifact",
      "--output",
      "json",
    ]);
    const unavailableContent = runByInProcess(fixture.root, [
      "validation-run",
      "artifact",
      fixture.validationRunId,
      missing.ref,
      "--output",
      "json",
    ]);

    expect(unknownRun.status).toBe(1);
    expect(JSON.parse(unknownRun.stdout)).toMatchObject({
      error: { code: "validation_run_not_found", validationRunId: "missing-run" },
      help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
    });
    expect(unknownArtifact.status).toBe(1);
    expect(JSON.parse(unknownArtifact.stdout)).toMatchObject({
      error: {
        code: "artifact_not_found",
        validationRunId: fixture.validationRunId,
        artifactRef: "missing-artifact",
      },
      help: [`Run \`by validation-run show ${fixture.validationRunId}\` to list known Artifacts.`],
    });
    expect(unavailableContent.status).toBe(1);
    expect(JSON.parse(unavailableContent.stdout)).toMatchObject({
      error: {
        code: "artifact_content_unavailable",
        validationRunId: fixture.validationRunId,
        artifactRef: missing.ref,
      },
      help: [
        `Run \`by validation-run show ${fixture.validationRunId}\` to inspect the recorded metadata.`,
      ],
    });
  });

  it("does not inspect a Task-owned Validation Run with the same ID", () => {
    const root = createInitializedRepo();
    const database = sqliteInput(root);
    database.withDatabase((connection) => {
      connection
        .prepare(
          `INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
           VALUES ('1', 1, 'Legacy', 'Legacy task', 'new', ?, ?)`,
        )
        .run(now, now);
      connection
        .prepare(
          `INSERT INTO validation_runs (
             id, task_id, task_validation_number, status, branch, commit_sha,
             github_owner, github_repo, github_base_branch,
             github_remote_name, github_remote_url, created_at, updated_at
           ) VALUES ('shared-id', '1', 1, 'active', 'feature', 'head',
             'acme', 'widgets', 'main', 'origin', 'https://example.com', ?, ?)`,
        )
        .run(now, now);
    });

    const result = runByInProcess(root, [
      "validation-run",
      "show",
      "shared-id",
      "--output",
      "json",
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("validation_run_not_found");
  });
});

const candidateValidationFixture = () => {
  const root = createInitializedRepo();
  const database = sqliteInput(root);
  const changeStore = openSqliteChangeStore(database);
  const candidateStore = openSqliteCandidateStore(database);
  const runStore = openSqliteCandidateValidationRunStore(database);
  const commonDirectory = join(root, ".git");
  const artifactsRoot = join(commonDirectory, "but-why", "artifacts");
  const changeResult = changeStore.createChange({
    repositoryCommonDirectory: commonDirectory,
    branchRef: "refs/heads/feature",
    now,
  });
  if (!changeResult.ok) throw new Error(changeResult.code);
  const candidateResult = candidateStore.captureCandidate({
    changeId: changeResult.change.id,
    selectedBaseRef: "refs/remotes/origin/main",
    resolvedTargetSha: "target-sha",
    comparisonBaseSha: "base-sha",
    headSha: "head-sha",
    now,
  });
  if (!candidateResult.ok) throw new Error(candidateResult.code);
  const runResult = runStore.startOrReuse({
    candidateId: candidateResult.candidate.id,
    headSha: candidateResult.candidate.headSha,
    policy,
    now,
  });
  if (runResult.reused) throw new Error("Expected a new Validation Run");

  const artifact = (
    phase: "prepare" | "checks",
    producer: string,
    fileName: string,
    content: string,
  ) => {
    const path = join(runResult.validationRunId, phase, producer, fileName);
    mkdirSync(join(artifactsRoot, runResult.validationRunId, phase, producer), { recursive: true });
    writeFileSync(join(artifactsRoot, path), content);
    const bytes = Buffer.byteLength(content);
    return {
      ref: `artifact:${runResult.validationRunId}/${phase}/${producer}/${fileName}`,
      validationRunId: runResult.validationRunId,
      phase,
      producer,
      path,
      originalBytes: bytes,
      storedBytes: bytes,
      truncated: false,
    };
  };

  return {
    root,
    runStore,
    artifactsRoot,
    artifact,
    validationRunId: runResult.validationRunId,
    candidateId: candidateResult.candidate.id,
    changeId: changeResult.change.id,
  };
};

const sqliteInput = (root: string) =>
  prepareStateDatabaseSession({
    statePath: join(root, ".git", "but-why", "state.sqlite"),
    migrationTimestamp: () => now,
  });
