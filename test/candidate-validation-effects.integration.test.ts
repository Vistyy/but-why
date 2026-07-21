import { join } from "node:path";

import { expect, layer } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";

import { piReviewerAgentRuntime } from "../src/agent/reviewerAgentRuntime.js";
import { captureLocalCandidate } from "./support/changeCandidateCapture.js";
import {
  CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationPersistence,
  CandidateReviewerAgentRuntime,
} from "../src/candidateValidation/validateCandidate.js";
import type { ChangeValidationPersistence } from "../src/changeValidation/changeValidationPersistence.js";
import { localCandidateValidationLayer } from "../src/localCandidateValidation/localCandidateValidationLayer.js";
import { repositorySqlLayer } from "../src/sqlite/repositorySql.js";
import { openSqliteChangeValidationPersistence } from "../src/sqlite/sqliteChangeValidationPersistence.js";
import {
  CheckCommandExecutionToolingFailed,
  GitToolingFailed,
  InfrastructureToolingFailed,
  PrepareCommandExecutionToolingFailed,
  ReviewerOutputContractFailed,
  SandcastleToolingFailed,
  TokenUsageContractFailed,
  ValidationWorkspaceSetupFailed,
  validationToolingFailureRecord,
  type ValidationToolingFailure,
} from "../src/validation/validationToolingFailures.js";
import { runByInProcessEffect } from "./support/by-cli.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
} from "./support/candidateReadyRepo.js";

const now = "2026-07-15T10:00:00.000Z";
const candidateValidationTestLayer = (repo: string, persistence: ChangeValidationPersistence) =>
  CandidateValidationLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CandidateValidationPaths, {
          localRepositoryMainCheckoutRoot: repo,
          artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
        }),
        Layer.succeed(CandidateValidationPersistence, persistence),
        Layer.succeed(CandidateReviewerAgentRuntime, piReviewerAgentRuntime),
      ),
    ),
  );

const policy = {
  sandboxMode: "none" as const,
  checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
  copyFiles: [],
  specialistReviews: [],
};

const toolingFailures = (): readonly ValidationToolingFailure[] => [
  new ValidationWorkspaceSetupFailed({
    operationName: "setup_workspace",
    tempRefName: "refs/but-why/validation/run",
    submittedSha: "head-sha",
    errorMessage: "Workspace setup failed.",
    cleanupResult: { worktree: "failed", tempRef: "removed" },
  }),
  new InfrastructureToolingFailed({
    operationName: "write_artifact",
    message: "Artifact write failed.",
  }),
  new GitToolingFailed({ operationName: "verify_candidate", message: "Git failed." }),
  new SandcastleToolingFailed({
    operationName: "create_sandbox",
    message: "Sandbox failed.",
  }),
  new PrepareCommandExecutionToolingFailed({
    operationName: "run_prepare_command",
    command: "pnpm install",
    message: "Prepare failed.",
  }),
  new CheckCommandExecutionToolingFailed({
    operationName: "run_check_command",
    command: "pnpm test",
    message: "Check failed.",
  }),
  new ReviewerOutputContractFailed({
    operationName: "parse_reviewer_output",
    reviewer: "acceptance",
    attempts: 3,
    diagnostics: [],
    message: "Reviewer output failed.",
  }),
  new TokenUsageContractFailed({
    operationName: "parse_token_usage",
    diagnostics: [],
    message: "Token usage failed.",
  }),
];

const expectedToolingFailures = [
  {
    errorKind: "validation_workspace_setup_failed",
    operationName: "setup_workspace",
    errorMessage: "Workspace setup failed.",
  },
  {
    errorKind: "infrastructure_tooling_failed",
    operationName: "write_artifact",
    errorMessage: "Artifact write failed.",
  },
  {
    errorKind: "git_tooling_failed",
    operationName: "verify_candidate",
    errorMessage: "Git failed.",
  },
  {
    errorKind: "sandcastle_tooling_failed",
    operationName: "create_sandbox",
    errorMessage: "Sandbox failed.",
  },
  {
    errorKind: "prepare_command_execution_tooling_failed",
    operationName: "run_prepare_command",
    errorMessage: "Prepare failed. Command: pnpm install.",
  },
  {
    errorKind: "check_command_execution_tooling_failed",
    operationName: "run_check_command",
    errorMessage: "Check failed. Command: pnpm test.",
  },
  {
    errorKind: "reviewer_output_contract_failed",
    operationName: "parse_reviewer_output",
    errorMessage: "Reviewer output failed. Reviewer: acceptance. Attempts: 3.",
  },
  {
    errorKind: "token_usage_contract_failed",
    operationName: "parse_token_usage",
    errorMessage: "Token usage failed.",
  },
] as const;

layer(Layer.empty)("Candidate validation Effect composition", (it) => {
  it.scoped("runs Candidate validation through test-provided Layers", () =>
    Effect.gen(function* () {
      const repo = candidateReadyRepo();
      const captured = yield* captureLocalCandidate({ cwd: repo, now });
      if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
      const sqliteInput = candidateSqliteInput(repo);
      const repositoryLayer = repositorySqlLayer({
        statePath: sqliteInput.statePath,
        commonDirectory: sqliteInput.commonDirectory ?? commonDirectory(repo),
      });

      yield* Effect.gen(function* () {
        const persistence = yield* openSqliteChangeValidationPersistence();
        yield* Effect.gen(function* () {
          const validation = yield* CandidateValidation;
          const result = yield* validation.validateCandidate({
            candidateId: captured.candidateId,
            comparisonBaseSha: captured.comparisonBaseSha,
            headSha: captured.headSha,
            policy,
            now,
          });

          expect(result).toMatchObject({ ok: true, outcome: "passed" });
          const validationRunId = result.validationRunId;
          expect(yield* persistence.listRounds(validationRunId)).toMatchObject([
            { phase: "checks", producer: "quality", status: "passed" },
          ]);
          expect(yield* persistence.listArtifacts(validationRunId)).toHaveLength(4);

          const productionResult = yield* Effect.gen(function* () {
            const productionValidation = yield* CandidateValidation;
            return yield* productionValidation.validateCandidate({
              candidateId: captured.candidateId,
              comparisonBaseSha: captured.comparisonBaseSha,
              headSha: captured.headSha,
              policy,
              now,
            });
          }).pipe(
            Effect.provide(
              localCandidateValidationLayer({
                localRepositoryMainCheckoutRoot: repo,
                artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
                persistence,
              }),
            ),
          );
          expect(productionResult).toMatchObject({ ok: true, reused: true, outcome: "passed" });
        }).pipe(Effect.provide(candidateValidationTestLayer(repo, persistence)));
      }).pipe(Effect.provide(repositoryLayer));
    }),
  );

  it.scoped("persists and displays every Tooling Failure variant", () =>
    Effect.gen(function* () {
      const repo = candidateReadyRepo();
      const captured = yield* captureLocalCandidate({ cwd: repo, now });
      if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
      const sqliteInput = candidateSqliteInput(repo);
      const repositoryLayer = repositorySqlLayer({
        statePath: sqliteInput.statePath,
        commonDirectory: sqliteInput.commonDirectory ?? commonDirectory(repo),
      });

      const validationRunId = yield* Effect.gen(function* () {
        const persistence = yield* openSqliteChangeValidationPersistence();
        const started = yield* persistence.startOrReuse({
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy,
          now,
        });
        if (started.reused) throw new Error("Expected a new Validation Run");
        for (const failure of toolingFailures()) {
          yield* persistence.recordToolingFailure({
            validationRunId: started.validationRunId,
            ...validationToolingFailureRecord(failure),
            now,
          });
        }
        yield* persistence.complete({
          validationRunId: started.validationRunId,
          outcome: "tooling_failed",
          now,
        });
        return started.validationRunId;
      }).pipe(Effect.provide(repositoryLayer));

      const result = yield* runByInProcessEffect(repo, [
        "validation-run",
        "show",
        validationRunId,
        "--output",
        "json",
      ]);
      expect(result.status).toBe(0);
      expect(
        JSON.parse(result.stdout).toolingFailures.map(
          (failure: { errorKind: string; operationName: string; errorMessage: string }) => ({
            errorKind: failure.errorKind,
            operationName: failure.operationName,
            errorMessage: failure.errorMessage,
          }),
        ),
      ).toEqual(expectedToolingFailures);
    }),
  );
});

layer(Layer.empty)("Candidate validation Effect timing", (it) => {
  it.effect("uses virtual time for an Effect-native timeout", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.sleep("10 seconds").pipe(
        Effect.timeoutOption("5 seconds"),
        Effect.fork,
      );
      yield* TestClock.adjust("5 seconds");
      expect(Option.isNone(yield* Fiber.join(fiber))).toBe(true);
    }),
  );
});
