import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-07-18T10:00:00.000Z";
const later = "2026-07-18T10:05:00.000Z";

const policy = {
  prepare: { command: "pnpm install", timeoutSeconds: 60 },
  checks: [
    { id: "types", command: "pnpm typecheck", timeoutSeconds: 30 },
    { id: "tests", command: "pnpm test", timeoutSeconds: 30 },
  ],
  copyFiles: [".env.test"],
};
let candidateValidationRepoTemplate: string;

beforeAll(() => {
  candidateValidationRepoTemplate = acquireTestWorkspace();
  createInitializedRepo(candidateValidationRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(candidateValidationRepoTemplate);
});

describe("Candidate-owned Validation Run inspection", () => {
  it.effect("abandons an interrupted Validation Run and is idempotent", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.recordWorkspaceSetup({
        validationRunId: fixture.validationRunId,
        tempRefName: `refs/but-why/validation-runs/${fixture.validationRunId}/validation`,
        submittedSha: "head-sha",
        worktreeHead: "head-sha",
        worktreePath: join(fixture.root, ".sandcastle", "validation-workspace"),
        cleanupWorktree: "not_created",
        cleanupTempRef: "not_created",
        now,
      });
      const abandoned = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "abandon",
        fixture.validationRunId,
        "--reason",
        "Validation process terminated.",
      ]);

      expect(abandoned.status).toBe(0);
      expect(abandoned.stdout).toContain("status: abandoned");
      expect(abandoned.stdout).toContain(`validationRunId: ${fixture.validationRunId}`);
      expect(yield* fixture.runStore.getRunById(fixture.validationRunId)).toMatchObject({
        state: "complete",
        outcome: "tooling_failed",
      });

      const repeated = yield* runByInProcessEffect(fixture.root, [
        "validation-run",
        "abandon",
        fixture.validationRunId,
        "--reason",
        "Repeated cleanup.",
      ]);
      expect(repeated.status).toBe(0);
      expect(repeated.stdout).toContain("status: already_complete");
    }),
  );

  it.effect("retains the exact Validation Workspace path for abandonment", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      const worktreePath = join(fixture.root, "linked-worktree", ".sandcastle", "validation");
      yield* fixture.runStore.recordWorkspaceSetup({
        validationRunId: fixture.validationRunId,
        tempRefName: "refs/but-why/validation-runs/run/validation",
        submittedSha: "head-sha",
        worktreeHead: "head-sha",
        worktreePath,
        cleanupWorktree: "not_created",
        cleanupTempRef: "not_created",
        now,
      });

      expect(yield* fixture.runStore.getAbandonmentContext(fixture.validationRunId)).toMatchObject({
        validationRunId: fixture.validationRunId,
        worktreePath,
      });
    }),
  );

  it.effect("records the initial Validation Workspace with the Active relation", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.complete({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
        now,
      });
      const workspace = {
        tempRefName: "refs/but-why/validation-runs/atomic/validation",
        worktreePath: join(fixture.root, ".sandcastle", "atomic-validation"),
      };
      const started = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
        policy,
        validationRunId: "run-with-atomic-workspace",
        workspaceSetup: workspace,
        now: later,
      });

      expect(started).toEqual({
        reused: false,
        validationRunId: "run-with-atomic-workspace",
      });
      expect(yield* fixture.runStore.getAbandonmentContext(started.validationRunId)).toMatchObject(
        workspace,
      );
    }),
  );

  it.effect("rejects a second Active Validation Run and clears the relation on completion", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      const second = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
        policy,
        now,
      });
      expect(second.reused).toBe(false);
      expect("active" in second && second.active).toBe(true);
      expect(second.validationRunId).toBe(fixture.validationRunId);

      yield* fixture.runStore.complete({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
        now: later,
      });
      const third = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
        policy,
        now: later,
      });
      expect(third.reused).toBe(false);
      expect(third.validationRunId).not.toBe(fixture.validationRunId);
    }),
  );

  it.effect("snapshots Implementation Decisions without changing policy reuse identity", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      yield* fixture.runStore.complete({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
        now,
      });
      const decision = {
        id: "decision-1",
        changeId: "change-1",
        sequence: 1,
        recordedAt: now,
        choice: "Keep rationale separate from intent",
        rationale: "Preserve rationale separately from approved intent.",
      };
      const first = yield* fixture.runStore.startOrReuse({
        candidateId: fixture.candidateId,
        headSha: "head-sha",
        policy,
        implementationDecisions: [decision],
        now,
      });
      expect(first.reused).toBe(false);
      const stored = yield* fixture.runStore.getRunById(first.validationRunId);
      expect(stored?.implementationDecisions).toEqual([decision]);
    }),
  );

  it.effect("shows the Candidate judgment and ordered evidence with bounded previews", () =>
    Effect.gen(function* () {
      const fixture = yield* candidateValidationFixture();
      const longContent = "x".repeat(1_200);

      yield* fixture.runStore.recordPrepareRound({
        validationRunId: fixture.validationRunId,
        roundNumber: 1,
        roundStatus: "passed",
        phaseStatus: "passed",
        artifactRecords: [fixture.artifact("prepare", "prepare", "logs.txt", "prepare complete\n")],
        now,
      });
      yield* fixture.runStore.recordCheckRound({
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
      yield* fixture.runStore.recordCheckRound({
        validationRunId: fixture.validationRunId,
        producer: "tests",
        roundNumber: 2,
        roundStatus: "passed",
        phaseStatus: "failed",
        artifactRecords: [fixture.artifact("checks", "tests", "stderr.txt", "")],
        now,
      });
      yield* fixture.runStore.recordToolingFailure({
        validationRunId: fixture.validationRunId,
        errorKind: "validation_workspace_setup_failed",
        operationName: "cleanup_validation_worktree",
        errorMessage: "Could not remove worktree.",
        now: later,
      });
      yield* fixture.runStore.complete({
        validationRunId: fixture.validationRunId,
        outcome: "tooling_failed",
        now: later,
      });

      const result = yield* runByInProcessEffect(fixture.root, [
        "--json",
        "validation-run",
        "show",
        fixture.validationRunId,
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
          changeBaseSha: "target-sha",
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
          { phase: "acceptance_review", rounds: [] },
          { phase: "specialist_review", rounds: [] },
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
            detailCommand: `by validation-run artifact ${fixture.validationRunId} artifact:${fixture.validationRunId}/prepare/prepare/logs.txt`,
            phase: "prepare",
            producer: "prepare",
            preview: {
              status: "available",
              content: "prepare complete\n",
              bytes: 17,
              storedBytes: 17,
              truncated: false,
            },
          }),
          expect.objectContaining({
            ref: `artifact:${fixture.validationRunId}/checks/tests/stderr.txt`,
            phase: "checks",
            producer: "tests",
          }),
          expect.objectContaining({
            ref: `artifact:${fixture.validationRunId}/checks/types/stdout.txt`,
            detailCommand: `by validation-run artifact ${fixture.validationRunId} artifact:${fixture.validationRunId}/checks/types/stdout.txt`,
            phase: "checks",
            producer: "types",
            preview: {
              status: "available",
              content: "x".repeat(1_000),
              bytes: 1_000,
              storedBytes: 1_200,
              truncated: true,
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
      const detail = yield* runByInProcessEffect(fixture.root, [
        "--json",
        "validation-run",
        "artifact",
        fixture.validationRunId,
        artifactRef,
      ]);
      expect(detail.status).toBe(0);
      expect(JSON.parse(detail.stdout)).toMatchObject({
        artifact: { ref: artifactRef, storedBytes: 1_200 },
        content: longContent,
      });
    }),
  );

  it.effect("keeps empty evidence distinct from unavailable artifact content", () =>
    Effect.gen(function* () {
      const empty = yield* candidateValidationFixture();
      yield* empty.runStore.recordPrepareRound({
        validationRunId: empty.validationRunId,
        roundNumber: 1,
        roundStatus: "passed",
        phaseStatus: "passed",
        artifactRecords: [empty.artifact("prepare", "prepare", "logs.txt", "prepare complete\n")],
        now,
      });
      yield* empty.runStore.complete({
        validationRunId: empty.validationRunId,
        outcome: "passed",
        now,
      });

      const emptyResult = yield* runByInProcessEffect(empty.root, [
        "--json",
        "validation-run",
        "show",
        empty.validationRunId,
      ]);
      expect(emptyResult.status).toBe(0);
      expect(JSON.parse(emptyResult.stdout)).toMatchObject({
        phases: [
          {
            phase: "prepare",
            rounds: [
              {
                validationRunId: empty.validationRunId,
                phase: "prepare",
                producer: "prepare",
                roundNumber: 1,
                status: "passed",
                createdAt: now,
              },
            ],
          },
          { phase: "checks", rounds: [] },
          { phase: "acceptance_review", rounds: [] },
          { phase: "specialist_review", rounds: [] },
        ],
        findings: [],
        toolingFailures: [],
        artifacts: [
          {
            ref: `artifact:${empty.validationRunId}/prepare/prepare/logs.txt`,
            validationRunId: empty.validationRunId,
            phase: "prepare",
            producer: "prepare",
            path: `${empty.validationRunId}/prepare/prepare/logs.txt`,
            originalBytes: 17,
            storedBytes: 17,
            truncated: false,
            createdAt: now,
            detailCommand: `by validation-run artifact ${empty.validationRunId} artifact:${empty.validationRunId}/prepare/prepare/logs.txt`,
          },
        ],
      });

      const unavailable = yield* candidateValidationFixture();
      const missing = unavailable.artifact("checks", "types", "stdout.txt", "missing");
      yield* unavailable.runStore.recordCheckRound({
        validationRunId: unavailable.validationRunId,
        producer: "types",
        roundNumber: 1,
        roundStatus: "passed",
        phaseStatus: "passed",
        artifactRecords: [missing],
        now,
      });
      rmSync(join(unavailable.artifactsRoot, missing.path));

      const unavailableResult = yield* runByInProcessEffect(unavailable.root, [
        "--json",
        "validation-run",
        "show",
        unavailable.validationRunId,
      ]);
      expect(unavailableResult.status).toBe(0);
      expect(JSON.parse(unavailableResult.stdout).artifacts[0]).toEqual({
        ref: missing.ref,
        validationRunId: unavailable.validationRunId,
        phase: "checks",
        producer: "types",
        path: missing.path,
        originalBytes: 7,
        storedBytes: 7,
        truncated: false,
        createdAt: now,
        detailCommand: `by validation-run artifact ${unavailable.validationRunId} ${missing.ref}`,
      });

      const unknownRun = yield* runByInProcessEffect(unavailable.root, [
        "--json",
        "validation-run",
        "show",
        "missing-run",
      ]);
      const unknownArtifact = yield* runByInProcessEffect(unavailable.root, [
        "--json",
        "validation-run",
        "artifact",
        unavailable.validationRunId,
        "missing-artifact",
      ]);
      const unavailableContent = yield* runByInProcessEffect(unavailable.root, [
        "--json",
        "validation-run",
        "artifact",
        unavailable.validationRunId,
        missing.ref,
      ]);

      expect(JSON.parse(unknownRun.stdout)).toMatchObject({
        error: { code: "validation_run_not_found", validationRunId: "missing-run" },
        help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
      });
      expect(JSON.parse(unknownArtifact.stdout)).toMatchObject({
        error: {
          code: "artifact_not_found",
          validationRunId: unavailable.validationRunId,
          artifactRef: "missing-artifact",
        },
        help: [
          `Run \`by validation-run show ${unavailable.validationRunId}\` to list known Artifacts.`,
        ],
      });
      expect(JSON.parse(unavailableContent.stdout)).toMatchObject({
        error: {
          code: "artifact_content_unavailable",
          validationRunId: unavailable.validationRunId,
          artifactRef: missing.ref,
        },
        help: [
          `Run \`by validation-run show ${unavailable.validationRunId}\` to inspect the recorded metadata.`,
        ],
      });
      expect([unknownRun.status, unknownArtifact.status, unavailableContent.status]).toEqual([
        1, 1, 1,
      ]);
    }),
  );
});

const candidateValidationFixture = () =>
  Effect.gen(function* () {
    const root = yield* cloneInitializedTestRepository(candidateValidationRepoTemplate);
    const commonDirectory = join(root, ".git");
    const artifactsRoot = join(commonDirectory, "but-why", "artifacts");
    const repositoryLayer = repositorySqlLayer({
      statePath: join(commonDirectory, "but-why", "state.sqlite"),
      commonDirectory,
    });
    const withPersistence = <A, E>(
      use: (persistence: ChangeValidationPersistence) => Effect.Effect<A, E>,
    ) =>
      Effect.flatMap(openSqliteChangeValidationPersistence(), use).pipe(
        Effect.provide(repositoryLayer),
      );
    const candidateResult = yield* openSqliteCandidateCapturePersistence().pipe(
      Effect.flatMap((capture) =>
        capture.commitCapture({
          repositoryCommonDirectory: commonDirectory,
          branchRef: "refs/heads/feature",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "target-sha",
          headSha: "head-sha",
          now,
        }),
      ),
      Effect.provide(repositoryLayer),
    );
    if (!candidateResult.ok) throw new Error(candidateResult.code);
    const runResult = yield* withPersistence((persistence) =>
      persistence.startOrReuse({
        candidateId: candidateResult.candidateId,
        headSha: "head-sha",
        policy,
        now,
      }),
    );
    if (runResult.reused) throw new Error("Expected a new Validation Run");

    const artifact = (
      phase: "prepare" | "checks" | "acceptance_review",
      producer: string,
      fileName: string,
      content: string,
    ) => {
      const path = join(runResult.validationRunId, phase, producer, fileName);
      mkdirSync(join(artifactsRoot, runResult.validationRunId, phase, producer), {
        recursive: true,
      });
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
    const runStore = {
      startOrReuse: (input: Parameters<ChangeValidationPersistence["startOrReuse"]>[0]) =>
        withPersistence((persistence) => persistence.startOrReuse(input)),
      getRunById: (runId: string) =>
        withPersistence((persistence) => persistence.getRunById(runId)),
      recordPrepareRound: (
        input: Parameters<ChangeValidationPersistence["recordPrepareRound"]>[0],
      ) => withPersistence((persistence) => persistence.recordPrepareRound(input)),
      recordCheckRound: (input: Parameters<ChangeValidationPersistence["recordCheckRound"]>[0]) =>
        withPersistence((persistence) => persistence.recordCheckRound(input)),
      recordAcceptanceRound: (
        input: Parameters<ChangeValidationPersistence["recordAcceptanceRound"]>[0],
      ) => withPersistence((persistence) => persistence.recordAcceptanceRound(input)),
      recordToolingFailure: (
        input: Parameters<ChangeValidationPersistence["recordToolingFailure"]>[0],
      ) => withPersistence((persistence) => persistence.recordToolingFailure(input)),
      recordWorkspaceSetup: (
        input: Parameters<ChangeValidationPersistence["recordWorkspaceSetup"]>[0],
      ) => withPersistence((persistence) => persistence.recordWorkspaceSetup(input)),
      getAbandonmentContext: (runId: string) =>
        withPersistence((persistence) => persistence.getAbandonmentContext(runId)),
      complete: (input: Parameters<ChangeValidationPersistence["complete"]>[0]) =>
        withPersistence((persistence) => persistence.complete(input)),
    };

    return {
      root,
      runStore,
      artifactsRoot,
      artifact,
      validationRunId: runResult.validationRunId,
      candidateId: candidateResult.candidateId,
      changeId: candidateResult.changeId,
    };
  });
