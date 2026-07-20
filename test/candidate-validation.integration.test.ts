import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, describe, vi } from "vitest";

import type { ReviewerAgentRuntime } from "../src/agent/reviewerAgentRuntime.js";
import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import {
  CandidateValidation,
  type ValidateCandidateInput,
} from "../src/candidateValidation/validateCandidate.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { candidateValidationForTest } from "./support/candidateValidation.js";
import { cleanupTempRoots } from "./support/by-cli.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
  git,
} from "./support/candidateReadyRepo.js";

const now = "2026-07-15T10:00:00.000Z";

afterEach(cleanupTempRoots);

describe("Candidate validation", () => {
  it.scoped(
    "runs every Check in one disposable workspace and reuses identical passing policy evidence",
    () =>
      Effect.gen(function* () {
        const repo = candidateReadyRepo();
        const captured = captureLocalCandidate({ cwd: repo, now });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;

        const validation = candidateValidationForTest({
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
          specialistReviews: [],
        };

        const first = yield* validateCandidate(validation, {
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy,
          now,
        });
        expect(first).toMatchObject({ ok: true, reused: false, outcome: "blocked" });
        if (!first.ok) return;
        expect(validation.listRounds(first.validationRunId)).toHaveLength(2);
        expect(validation.listFindings(first.validationRunId)).toHaveLength(1);

        const passingPolicy = {
          ...policy,
          checks: [{ id: "passes", command: "git rev-parse --verify HEAD", timeoutSeconds: 1 }],
        };
        const passing = yield* validateCandidate(validation, {
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy: passingPolicy,
          now,
        });
        expect(passing).toMatchObject({ ok: true, reused: false, outcome: "passed" });
        if (!passing.ok) return;
        expect(validation.listArtifacts(passing.validationRunId)).toContainEqual(
          expect.objectContaining({ truncated: false, originalBytes: expect.any(Number) }),
        );

        const reused = yield* validateCandidate(validation, {
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
          headSha: captured.headSha,
          policy: passingPolicy,
          now,
        });
        expect(reused).toEqual({
          ok: true,
          reused: true,
          validationRunId: passing.validationRunId,
          outcome: "passed",
        });
      }),
  );

  it.scoped("stops Checks after a failed Prepare", () =>
    Effect.gen(function* () {
      const repo = candidateReadyRepo();
      const captured = captureLocalCandidate({ cwd: repo, now });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      const validation = candidateValidationForTest({
        localRepositoryMainCheckoutRoot: repo,
        artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
        runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
      });

      const result = yield* validateCandidate(validation, {
        candidateId: captured.candidateId,
        comparisonBaseSha: captured.comparisonBaseSha,
        headSha: captured.headSha,
        policy: {
          sandboxMode: "none",
          prepare: { command: "exit 1", timeoutSeconds: 1 },
          checks: [{ id: "skipped", command: "exit 1", timeoutSeconds: 1 }],
          copyFiles: [],
          specialistReviews: [],
        },
        now,
      });

      expect(result).toMatchObject({ ok: true, outcome: "blocked" });
      if (!result.ok) return;
      expect(validation.listRounds(result.validationRunId)).toEqual([
        { producer: "prepare", status: "failed" },
      ]);
    }),
  );

  it.scoped("fails tooling when a Check changes the Candidate worktree head", () =>
    Effect.gen(function* () {
      const repo = candidateReadyRepo();
      const captured = captureLocalCandidate({ cwd: repo, now });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      const validation = candidateValidationForTest({
        localRepositoryMainCheckoutRoot: repo,
        artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
        runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
      });

      const result = yield* validateCandidate(validation, {
        candidateId: captured.candidateId,
        comparisonBaseSha: captured.comparisonBaseSha,
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
          specialistReviews: [],
        },
        now,
      });

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
    }),
  );

  it.scoped("rejects a copied local validation file tracked by the Candidate", () =>
    Effect.gen(function* () {
      const repo = candidateReadyRepo();
      writeFileSync(join(repo, ".validation-env"), "candidate=true\n");
      git(repo, "add", ".validation-env");
      git(repo, "commit", "-m", "track validation environment");
      const captured = captureLocalCandidate({ cwd: repo, now });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      writeFileSync(join(repo, ".validation-env"), "local=true\n");

      const validation = candidateValidationForTest({
        localRepositoryMainCheckoutRoot: repo,
        artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
        runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
      });
      const result = yield* validateCandidate(validation, {
        candidateId: captured.candidateId,
        comparisonBaseSha: captured.comparisonBaseSha,
        headSha: captured.headSha,
        policy: {
          sandboxMode: "none",
          checks: [{ id: "must-not-run", command: "exit 0", timeoutSeconds: 1 }],
          copyFiles: [".validation-env"],
          specialistReviews: [],
        },
        now,
      });

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(validation.listRounds(result.validationRunId)).toEqual([]);
    }),
  );

  it.scoped("runs configured Specialists for a taskless changed-code Candidate", () =>
    Effect.gen(function* () {
      const repo = candidateReadyRepo();
      const captured = captureLocalCandidate({ cwd: repo, now });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
        Effect.succeed({ ok: true, report: { findings: [] }, attempts: 1, stdout: "" }),
      );
      const validation = candidateValidationForTest({
        localRepositoryMainCheckoutRoot: repo,
        artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
        runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
        reviewerAgentRuntime: { review },
      });

      const result = yield* validateCandidate(validation, {
        candidateId: captured.candidateId,
        comparisonBaseSha: captured.comparisonBaseSha,
        headSha: captured.headSha,
        policy: {
          sandboxMode: "none",
          checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
          copyFiles: [],
          specialistReviews: [
            {
              id: "standards",
              instructions: "Review repository standards.",
              instructionsSource: "global",
              agentProfile: "default",
              profileSource: "global",
              profile: {
                agentRuntime: "pi",
                agentModel: "openai-codex/gpt-5.5",
              },
            },
          ],
        },
        now,
      });

      expect(result).toMatchObject({ ok: true, outcome: "passed" });
      expect(review).toHaveBeenCalledOnce();
      expect(review).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewer: "standards",
          prompt: expect.stringContaining(captured.headSha),
        }),
      );
    }),
  );

  it.scoped(
    "copies a regular local validation file from the main checkout without changing Candidate identity",
    () =>
      Effect.gen(function* () {
        const mainCheckout = candidateReadyRepo();
        const candidateCheckout = join(commonDirectory(mainCheckout), "candidate-worktree");
        git(
          mainCheckout,
          "worktree",
          "add",
          "-q",
          "-b",
          "linked-candidate",
          candidateCheckout,
          "HEAD",
        );
        const captured = captureLocalCandidate({ cwd: candidateCheckout, now });
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;
        writeFileSync(join(mainCheckout, ".validation-env"), "source=main\n");
        writeFileSync(join(candidateCheckout, ".validation-env"), "source=candidate\n");

        const validation = candidateValidationForTest({
          localRepositoryMainCheckoutRoot: mainCheckout,
          artifactsRoot: join(commonDirectory(mainCheckout), "but-why", "artifacts"),
          runStore: openSqliteCandidateValidationRunStore(sqliteInput(mainCheckout)),
        });
        const result = yield* validateCandidate(validation, {
          candidateId: captured.candidateId,
          comparisonBaseSha: captured.comparisonBaseSha,
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
            specialistReviews: [],
          },
          now,
        });

        expect(result).toMatchObject({ ok: true, outcome: "passed" });
        expect(git(candidateCheckout, "rev-parse", "HEAD")).toBe(captured.headSha);
      }),
  );
});

const validateCandidate = (
  validation: ReturnType<typeof candidateValidationForTest>,
  input: ValidateCandidateInput,
) =>
  Effect.gen(function* () {
    const service = yield* CandidateValidation;
    return yield* service.validateCandidate(input);
  }).pipe(Effect.provide(validation.layer));

const sqliteInput = (root: string) => candidateSqliteInput(root, now);
