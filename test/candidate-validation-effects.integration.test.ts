import { join } from "node:path";

import { expect, layer } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { afterEach } from "vitest";

import { piReviewerAgentRuntime } from "../src/agent/reviewerAgentRuntime.js";
import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import {
  CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationRunStore,
  CandidateReviewerAgentRuntime,
} from "../src/candidateValidation/validateCandidate.js";
import { localCandidateValidationLayer } from "../src/localCandidateValidation/localCandidateValidationLayer.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { cleanupTempRoots } from "./support/by-cli.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
} from "./support/candidateReadyRepo.js";

const now = "2026-07-15T10:00:00.000Z";
const repo = candidateReadyRepo();
const captured = captureLocalCandidate({ cwd: repo, now });
if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
const runStore = openSqliteCandidateValidationRunStore(candidateSqliteInput(repo, now));
const candidateValidationTestLayer = CandidateValidationLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.succeed(CandidateValidationPaths, {
        localRepositoryMainCheckoutRoot: repo,
        artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      }),
      Layer.succeed(CandidateValidationRunStore, runStore),
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

afterEach(cleanupTempRoots);

layer(candidateValidationTestLayer)("Candidate validation Effect composition", (it) => {
  it.scoped("runs Candidate validation through test-provided Layers", () =>
    Effect.gen(function* () {
      const validation = yield* CandidateValidation;
      const result = yield* validation.validateCandidate({
        candidateId: captured.candidateId,
        comparisonBaseSha: captured.comparisonBaseSha,
        headSha: captured.headSha,
        policy,
        now,
      });

      expect(result).toMatchObject({ ok: true, outcome: "passed" });

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
            runStore,
          }),
        ),
      );
      expect(productionResult).toMatchObject({ ok: true, reused: true, outcome: "passed" });
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
