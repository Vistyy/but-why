import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { prepareStateDatabase } from "../src/init/stateDatabase.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { runByInProcessEffect } from "./support/by-cli.js";
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

describe("Candidate-owned Validation Run inspection", () => {
  it.effect("shows the Candidate judgment and ordered evidence with bounded previews", () =>
    Effect.gen(function* () {
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

      const result = yield* runByInProcessEffect(fixture.root, [
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
      const detail = yield* runByInProcessEffect(fixture.root, [
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
    }),
  );

  it.effect("keeps empty evidence distinct from unavailable artifact content", () =>
    Effect.gen(function* () {
      const empty = candidateValidationFixture();
      empty.runStore.complete({ validationRunId: empty.validationRunId, outcome: "passed", now });

      const emptyResult = yield* runByInProcessEffect(empty.root, [
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
          { phase: "acceptance_review", rounds: [] },
          { phase: "specialist_review", rounds: [] },
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

      const unavailableResult = yield* runByInProcessEffect(unavailable.root, [
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
    }),
  );

  it.effect.each([
    { name: "passed", roundStatus: "passed", outcome: "passed", finding: false, tooling: false },
    {
      name: "Finding-blocked",
      roundStatus: "failed",
      outcome: "blocked",
      finding: true,
      tooling: false,
    },
    {
      name: "tooling-failed",
      roundStatus: "failed",
      outcome: "tooling_failed",
      finding: false,
      tooling: true,
    },
  ] as const)(
    "shows $name Acceptance Review evidence",
    ({ roundStatus, outcome, finding, tooling }) =>
      Effect.gen(function* () {
        const fixture = candidateValidationFixture();
        fixture.runStore.recordAcceptanceRound({
          validationRunId: fixture.validationRunId,
          roundNumber: 1,
          roundStatus,
          phaseStatus: roundStatus,
          artifactRecords: [],
          findings: finding
            ? [
                {
                  id: `${fixture.validationRunId}-acceptance-F1`,
                  validationRunId: fixture.validationRunId,
                  phase: "acceptance_review",
                  producer: "acceptance",
                  title: "Acceptance mismatch",
                  description: "The Candidate does not satisfy approved intent.",
                  severity: "high",
                  evidence: "Observed behavior differs from Acceptance Context.",
                  files: [],
                  artifactRefs: [],
                },
              ]
            : [],
          now,
        });
        if (tooling) {
          fixture.runStore.recordToolingFailure({
            validationRunId: fixture.validationRunId,
            errorKind: "reviewer_output_contract_failed",
            operationName: "decode_reviewer_output",
            errorMessage: "Structured output retries exhausted.",
            now,
          });
        }
        fixture.runStore.complete({ validationRunId: fixture.validationRunId, outcome, now });

        const result = yield* runByInProcessEffect(fixture.root, [
          "validation-run",
          "show",
          fixture.validationRunId,
          "--output",
          "json",
        ]);
        const output = JSON.parse(result.stdout);
        expect(result.status).toBe(0);
        expect(output.phases).toContainEqual({
          phase: "acceptance_review",
          rounds: [
            expect.objectContaining({
              phase: "acceptance_review",
              producer: "acceptance",
              status: roundStatus,
            }),
          ],
        });
        expect(output.findings).toHaveLength(finding ? 1 : 0);
        expect(output.toolingFailures).toHaveLength(tooling ? 1 : 0);
      }),
  );

  it.effect(
    "returns typed actionable errors for unknown Runs, Artifacts, and unavailable content",
    () =>
      Effect.gen(function* () {
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

        const unknownRun = yield* runByInProcessEffect(fixture.root, [
          "validation-run",
          "show",
          "missing-run",
          "--output",
          "json",
        ]);
        const unknownArtifact = yield* runByInProcessEffect(fixture.root, [
          "validation-run",
          "artifact",
          fixture.validationRunId,
          "missing-artifact",
          "--output",
          "json",
        ]);
        const unavailableContent = yield* runByInProcessEffect(fixture.root, [
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
          help: [
            "Run `by change show <change-id>` to inspect known Candidates and Validation Runs.",
          ],
        });
        expect(unknownArtifact.status).toBe(1);
        expect(JSON.parse(unknownArtifact.stdout)).toMatchObject({
          error: {
            code: "artifact_not_found",
            validationRunId: fixture.validationRunId,
            artifactRef: "missing-artifact",
          },
          help: [
            `Run \`by validation-run show ${fixture.validationRunId}\` to list known Artifacts.`,
          ],
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
      }),
  );
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
    phase: "prepare" | "checks" | "acceptance_review",
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
  prepareStateDatabase({
    statePath: join(root, ".git", "but-why", "state.sqlite"),
  });
