import { join } from "node:path";

import { expect as effectExpect, layer } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  CandidateValidation,
  CandidateValidationLive,
  CandidateValidationPaths,
  CandidateValidationProduction,
  CandidateValidationRunStore,
  CandidateReviewerAgentRuntime,
} from "../src/candidateValidation/validateCandidate.js";
import { piReviewerAgentRuntime } from "../src/agent/reviewerAgentRuntime.js";
import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { cleanupTempRoots } from "./support/by-cli.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
} from "./support/candidateReadyRepo.js";

const now = "2026-07-15T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("Candidate validation Effect composition", () => {
  it("runs Candidate validation through test-provided Layers", async () => {
    const repo = candidateReadyRepo();
    const captured = captureLocalCandidate({ cwd: repo, now });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const layer = CandidateValidationLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(CandidateValidationPaths, {
            localRepositoryMainCheckoutRoot: repo,
            artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
          }),
          Layer.succeed(
            CandidateValidationRunStore,
            openSqliteCandidateValidationRunStore(candidateSqliteInput(repo, now)),
          ),
          Layer.succeed(CandidateReviewerAgentRuntime, piReviewerAgentRuntime),
        ),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const validation = yield* CandidateValidation;
        return yield* validation.validateCandidate({
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy: {
            sandboxMode: "none",
            checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
            copyFiles: [],
            specialistReviews: [],
          },
          now,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({ ok: true, outcome: "passed" });

    const productionResult = await Effect.runPromise(
      Effect.gen(function* () {
        const validation = yield* CandidateValidation;
        return yield* validation.validateCandidate({
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy: {
            sandboxMode: "none",
            checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
            copyFiles: [],
            specialistReviews: [],
          },
          now,
        });
      }).pipe(
        Effect.provide(
          CandidateValidationProduction({
            localRepositoryMainCheckoutRoot: repo,
            artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
            runStore: openSqliteCandidateValidationRunStore(candidateSqliteInput(repo, now)),
          }),
        ),
      ),
    );
    expect(productionResult).toMatchObject({ ok: true, reused: true, outcome: "passed" });
  });
});

layer(Layer.empty)("Candidate validation Effect timing", (it) => {
  it.effect("uses virtual time for an Effect-native timeout", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.sleep("10 seconds").pipe(
        Effect.timeoutOption("5 seconds"),
        Effect.fork,
      );
      yield* TestClock.adjust("5 seconds");
      effectExpect(Option.isNone(yield* Fiber.join(fiber))).toBe(true);
    }),
  );
});
