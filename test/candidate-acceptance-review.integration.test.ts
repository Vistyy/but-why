import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, vi } from "vitest";

import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../src/agent/reviewerAgentRuntime.js";
import type { CaptureLocalCandidateResult } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import { captureLocalCandidate } from "./support/changeCandidateCapture.js";
import {
  CandidateValidation,
  type TaskBackedCandidateValidationPolicy,
} from "../src/candidateValidation/validateCandidate.js";
import { candidateValidationForTest } from "./support/candidateValidation.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import type { RepositoryStorageError } from "../src/repositoryStorageError.js";
import { ReviewerOutputContractFailed } from "../src/validation/validationToolingFailures.js";
import type { TaskContextSnapshotV1 } from "../src/validationRun/taskContextSnapshot.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
  git,
} from "./support/candidateReadyRepo.js";

const now = "2026-07-15T10:00:00.000Z";
const acceptanceContext = Object.freeze({
  version: 1 as const,
  title: "Keep the exact intent",
  description: "Review the Candidate against this immutable context.",
  comments: Object.freeze(["Do not infer intent from mutable Task state."]),
}) satisfies TaskContextSnapshotV1;

const acceptancePolicy = {
  instructions: "Repository Acceptance instructions",
  instructionsSource: "repo" as const,
  agentProfile: "strict",
  profileSource: "repo" as const,
  profile: {
    agentRuntime: "pi" as const,
    agentModel: "openai-codex/gpt-5.5",
    thinking: "high" as const,
  },
};

const specialistPolicy = (id: string) => ({
  id,
  instructions: `${id} review instructions`,
  instructionsSource: "repo" as const,
  agentProfile: "strict",
  profileSource: "repo" as const,
  profile: acceptancePolicy.profile,
});

const passingValidationPolicy = {
  sandboxMode: "none" as const,
  checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
  copyFiles: [],
  acceptanceReview: acceptancePolicy,
  specialistReviews: [],
};

describe("Task-backed Candidate Acceptance Review", () => {
  it.scoped(
    "reviews the exact Candidate and immutable Acceptance Context after passing Checks",
    () =>
      Effect.gen(function* () {
        const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
          Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
          }),
        );
        const ready = yield* acceptanceReadyRepo({ review });
        const { captured, validation } = ready;

        const result = yield* runTaskBackedCandidate(ready);

        expect(result).toMatchObject({ ok: true, reused: false, outcome: "passed" });
        if (!result.ok) return;
        expect(review).toHaveBeenCalledOnce();
        expect(review).toHaveBeenCalledWith(
          expect.objectContaining({
            reviewer: "acceptance",
            profile: acceptancePolicy.profile,
            prompt: expect.stringContaining(captured.headSha),
          }),
        );
        const prompt = review.mock.calls[0]?.[0].prompt;
        expect(prompt).toContain(result.validationRunId);
        expect(prompt).toContain(captured.comparisonBaseSha);
        expect(prompt).toContain(acceptanceContext.description);
        expect(prompt).toContain(acceptancePolicy.instructions);
        expect(prompt).toContain("<reviewer-output>");
        expect(validation.listRounds(result.validationRunId)).toEqual([
          { producer: "quality", status: "passed" },
          { producer: "acceptance", status: "passed" },
        ]);
        expect(validation.listArtifacts(result.validationRunId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: "acceptance_review", producer: "acceptance" }),
          ]),
        );
      }),
  );

  it.scoped(
    "rechecks earlier Acceptance Findings only after a blind successor Candidate review",
    () =>
      Effect.gen(function* () {
        const earlierFinding = reviewerFinding("Earlier acceptance Finding");
        const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
          Effect.succeed({
            ok: true,
            report: { findings: [earlierFinding] },
            attempts: 1,
            stdout: "earlier acceptance report",
          }),
        );
        const ready = yield* acceptanceReadyRepo({ review });

        const earlier = yield* runTaskBackedCandidate(ready);
        expect(earlier).toMatchObject({ ok: true, outcome: "blocked" });
        if (!earlier.ok) return;

        git(ready.repo, "commit", "--allow-empty", "-m", "address acceptance Finding");
        const successor = yield* captureLocalCandidate({ cwd: ready.repo, now });
        expect(successor.ok).toBe(true);
        if (!successor.ok) return;

        review.mockImplementationOnce(() =>
          Effect.succeed({
            ok: true,
            report: { findings: [reviewerFinding("Provisional new Finding")] },
            attempts: 1,
            stdout: "provisional acceptance report",
          }),
        );
        review.mockImplementationOnce(() =>
          Effect.succeed({
            ok: true,
            report: { findings: [reviewerFinding("Unresolved earlier Finding")] },
            attempts: 1,
            stdout: "final acceptance report",
          }),
        );

        const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

        expect(final).toMatchObject({ ok: true, outcome: "blocked" });
        expect(review).toHaveBeenCalledTimes(3);
        const blindPrompt = review.mock.calls[1]?.[0].prompt;
        expect(blindPrompt).not.toContain(earlierFinding.title);
        const finalPrompt = review.mock.calls[2]?.[0].prompt;
        expect(finalPrompt).toContain("Provisional new Finding");
        expect(finalPrompt).toContain(earlierFinding.title);
        expect(finalPrompt).not.toContain(earlier.validationRunId);
        expect(
          ready.validation.listFindings(final.validationRunId).map((finding) => finding.title),
        ).toEqual(["Unresolved earlier Finding"]);
        expect(
          ready.validation.listFindings(earlier.validationRunId).map((finding) => finding.title),
        ).toEqual([earlierFinding.title]);
      }),
  );

  it.scoped("does not carry Findings past the immediately preceding Candidate", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier acceptance Finding");
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [earlierFinding] },
          attempts: 1,
          stdout: "earlier acceptance report",
        }),
      );
      const ready = yield* acceptanceReadyRepo({ review });

      const earlier = yield* runTaskBackedCandidate(ready);
      expect(earlier).toMatchObject({ ok: true, outcome: "blocked" });
      if (!earlier.ok) return;

      git(ready.repo, "commit", "--allow-empty", "-m", "run failing checks");
      const intermediate = yield* captureLocalCandidate({ cwd: ready.repo, now });
      expect(intermediate.ok).toBe(true);
      if (!intermediate.ok) return;
      const intermediateResult = yield* runTaskBackedCandidate(
        ready,
        {
          ...passingValidationPolicy,
          checks: [{ id: "fails", command: "false", timeoutSeconds: 1 }],
        },
        intermediate,
      );
      expect(intermediateResult).toMatchObject({ ok: true, outcome: "blocked" });

      git(ready.repo, "commit", "--allow-empty", "-m", "fix checks");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now });
      expect(successor.ok).toBe(true);
      if (!successor.ok) return;
      review.mockImplementationOnce(() =>
        Effect.succeed({ ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted" }),
      );

      const result = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(result).toMatchObject({ ok: true, outcome: "passed" });
      expect(review).toHaveBeenCalledTimes(2);
      expect(review.mock.calls[1]?.[0].prompt).not.toContain(earlierFinding.title);
    }),
  );

  it.scoped("records exhausted final Acceptance output correction as a Tooling Failure", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier acceptance Finding");
      const failure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "acceptance",
        attempts: 2,
        diagnostics: [],
        message: "Final output correction failed.",
      });
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [earlierFinding] },
          attempts: 1,
          stdout: "earlier acceptance report",
        }),
      );
      const ready = yield* acceptanceReadyRepo({ review });
      const earlier = yield* runTaskBackedCandidate(ready);
      expect(earlier).toMatchObject({ ok: true, outcome: "blocked" });
      if (!earlier.ok) return;

      git(ready.repo, "commit", "--allow-empty", "-m", "address acceptance Finding");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now });
      expect(successor.ok).toBe(true);
      if (!successor.ok) return;

      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [] },
          attempts: 1,
          stdout: "provisional acceptance report",
        }),
      );
      review.mockImplementationOnce(() =>
        Effect.succeed({ ok: false, failure, attempts: 2, stdout: "invalid final output" }),
      );

      const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(final).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(review).toHaveBeenCalledTimes(3);
      expect(ready.validation.listFindings(final.validationRunId)).toEqual([]);
      expect(ready.validation.listToolingFailures(final.validationRunId)).toEqual([
        expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
      ]);
    }),
  );

  it.scoped("does not start Acceptance after a Prepare or Check Finding", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
        Effect.succeed({ ok: true as const, report: { findings: [] }, attempts: 1, stdout: "" }),
      );

      for (const policy of [
        {
          ...passingValidationPolicy,
          prepare: { command: "false", timeoutSeconds: 1 },
          checks: [{ id: "skipped", command: "true", timeoutSeconds: 1 }],
        },
        {
          ...passingValidationPolicy,
          checks: [{ id: "fails", command: "false", timeoutSeconds: 1 }],
        },
      ]) {
        const ready = yield* acceptanceReadyRepo({ review });
        const result = yield* runTaskBackedCandidate(ready, policy);
        expect(result).toMatchObject({ ok: true, outcome: "blocked" });
      }

      expect(review).not.toHaveBeenCalled();
    }),
  );

  it.scoped("blocks on every Acceptance Finding and stores reviewer evidence", () =>
    Effect.gen(function* () {
      const ready = yield* acceptanceReadyRepo({
        review: () =>
          Effect.succeed({
            ok: true,
            report: {
              findings: [
                {
                  title: "First mismatch",
                  description: "The first requirement is incomplete.",
                  severity: "high",
                  evidence: "Observed incomplete behavior.",
                  files: ["src/first.ts"],
                  artifactRefs: [],
                },
                {
                  title: "Second mismatch",
                  description: "The second requirement is incomplete.",
                  severity: "low",
                  evidence: "Observed another incomplete behavior.",
                  files: [],
                  artifactRefs: [],
                },
              ],
            },
            attempts: 1,
            stdout: "review evidence",
          }),
      });
      const { validation } = ready;

      const result = yield* runTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: true, outcome: "blocked" });
      expect(validation.listFindings(result.validationRunId)).toHaveLength(2);
      expect(validation.listArtifacts(result.validationRunId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("stdout.txt") }),
          expect.objectContaining({ path: expect.stringContaining("reviewer-output.json") }),
        ]),
      );
    }),
  );

  it.scoped(
    "rechecks earlier Specialist Findings only after a blind successor Candidate review",
    () =>
      Effect.gen(function* () {
        const earlierFinding = reviewerFinding("Earlier specialist Finding");
        const reports: readonly ReviewerAgentResult[] = [
          { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted" },
          {
            ok: true,
            report: { findings: [earlierFinding] },
            attempts: 1,
            stdout: "earlier standards",
          },
          { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted successor" },
          {
            ok: true,
            report: { findings: [reviewerFinding("Provisional specialist Finding")] },
            attempts: 1,
            stdout: "provisional standards",
          },
          {
            ok: true,
            report: { findings: [reviewerFinding("Final specialist Finding")] },
            attempts: 1,
            stdout: "final standards",
          },
        ];
        let reportIndex = 0;
        const review = vi.fn<ReviewerAgentRuntime["review"]>(() => {
          const report = reports[reportIndex++];
          if (report === undefined) throw new Error("Unexpected review request.");
          return Effect.succeed(report);
        });
        const ready = yield* acceptanceReadyRepo({ review });
        const policy = {
          ...passingValidationPolicy,
          specialistReviews: [specialistPolicy("standards")],
        };

        const earlier = yield* runTaskBackedCandidate(ready, policy);
        expect(earlier).toMatchObject({ ok: true, outcome: "blocked" });
        if (!earlier.ok) return;

        git(ready.repo, "commit", "--allow-empty", "-m", "address specialist Finding");
        const successor = yield* captureLocalCandidate({ cwd: ready.repo, now });
        expect(successor.ok).toBe(true);
        if (!successor.ok) return;

        const final = yield* runTaskBackedCandidate(ready, policy, successor);

        expect(final).toMatchObject({ ok: true, outcome: "blocked" });
        expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
          "acceptance",
          "standards",
          "acceptance",
          "standards",
          "standards",
        ]);
        const blindPrompt = review.mock.calls[3]?.[0].prompt;
        expect(blindPrompt).not.toContain(earlierFinding.title);
        const finalPrompt = review.mock.calls[4]?.[0].prompt;
        expect(finalPrompt).toContain("Provisional specialist Finding");
        expect(finalPrompt).toContain(earlierFinding.title);
        expect(finalPrompt).not.toContain(earlier.validationRunId);
        expect(
          ready.validation.listFindings(final.validationRunId).map((finding) => finding.title),
        ).toEqual(["Final specialist Finding"]);
        expect(
          ready.validation.listFindings(earlier.validationRunId).map((finding) => finding.title),
        ).toEqual([earlierFinding.title]);
      }),
  );

  it.scoped(
    "runs configured Specialists once and keeps trustworthy results in configured order",
    () =>
      Effect.gen(function* () {
        const finding = (title: string): ReviewerAgentResult => ({
          ok: true,
          report: {
            findings: [
              {
                title,
                description: `${title} description`,
                severity: "high",
                evidence: `${title} evidence`,
                files: [],
                artifactRefs: [],
              },
            ],
          },
          attempts: 1,
          stdout: `${title} output`,
        });
        const failure = new ReviewerOutputContractFailed({
          operationName: "decode_reviewer_output",
          reviewer: "broken",
          attempts: 2,
          diagnostics: [],
          message: "Broken Specialist output.",
        });
        const review = vi.fn<ReviewerAgentRuntime["review"]>((input) => {
          const results: Record<string, ReviewerAgentResult> = {
            acceptance: { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted" },
            zeta: finding("Zeta Finding"),
            broken: { ok: false, failure, attempts: 2, stdout: "invalid" },
            alpha: finding("Alpha Finding"),
          };
          const result = results[input.reviewer];
          if (result === undefined) throw new Error(`Unexpected reviewer: ${input.reviewer}`);
          return Effect.succeed(result);
        });
        const ready = yield* acceptanceReadyRepo({ review });

        const result = yield* runTaskBackedCandidate(ready, {
          ...passingValidationPolicy,
          specialistReviews: [
            specialistPolicy("zeta"),
            specialistPolicy("broken"),
            specialistPolicy("alpha"),
          ],
        });

        expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
        expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
          "acceptance",
          "zeta",
          "broken",
          "alpha",
        ]);
        for (const [input] of review.mock.calls.slice(1)) {
          expect(input.availableArtifactRefs).toEqual([]);
          expect(input.prompt).toContain(ready.captured.comparisonBaseSha);
          expect(input.prompt).toContain(ready.captured.headSha);
          expect(input.prompt).toContain(`${input.reviewer} review instructions`);
          expect(input.prompt).not.toContain(ready.captured.candidateId);
          expect(input.prompt).not.toContain("availableArtifactRefs");
          expect(input.prompt).not.toContain(acceptanceContext.description);
        }
        expect(
          ready.validation.listFindings(result.validationRunId).map((item) => item.title),
        ).toEqual(["Zeta Finding", "Alpha Finding"]);
        expect(ready.validation.listRounds(result.validationRunId)).toEqual([
          { producer: "quality", status: "passed" },
          { producer: "acceptance", status: "passed" },
          { producer: "zeta", status: "failed" },
          { producer: "broken", status: "failed" },
          { producer: "alpha", status: "failed" },
        ]);
        expect(ready.validation.listToolingFailures(result.validationRunId)).toEqual([
          expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
        ]);
        expect(ready.validation.listArtifacts(result.validationRunId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: "specialist_review", producer: "zeta" }),
            expect.objectContaining({ phase: "specialist_review", producer: "broken" }),
            expect.objectContaining({ phase: "specialist_review", producer: "alpha" }),
          ]),
        );
      }),
  );

  it.scoped("blocks the Candidate on a Specialist Finding", () =>
    Effect.gen(function* () {
      const ready = yield* acceptanceReadyRepo({
        review: (input) =>
          Effect.succeed(
            input.reviewer === "acceptance"
              ? { ok: true, report: { findings: [] }, attempts: 1, stdout: "" }
              : {
                  ok: true,
                  report: {
                    findings: [
                      {
                        title: "Specialist Finding",
                        description: "A configured concern failed.",
                        severity: "low",
                        evidence: "Specialist evidence.",
                        files: [],
                        artifactRefs: [],
                      },
                    ],
                  },
                  attempts: 1,
                  stdout: "",
                },
          ),
      });

      const result = yield* runTaskBackedCandidate(ready, {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("standards")],
      });
      expect(result).toMatchObject({ ok: true, outcome: "blocked" });
    }),
  );

  it.scoped("records structured-output exhaustion as tooling failure without a Finding", () =>
    Effect.gen(function* () {
      const failure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "acceptance",
        attempts: 2,
        diagnostics: [],
        message: "Structured output correction failed.",
      });
      const ready = yield* acceptanceReadyRepo({
        review: () => Effect.succeed({ ok: false, failure, attempts: 2, stdout: "invalid output" }),
      });
      const { validation } = ready;

      const result = yield* runTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(validation.listFindings(result.validationRunId)).toEqual([]);
      expect(validation.listToolingFailures(result.validationRunId)).toEqual([
        expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
      ]);
      expect(validation.listArtifacts(result.validationRunId)).toContainEqual(
        expect.objectContaining({ phase: "acceptance_review", producer: "acceptance" }),
      );
    }),
  );
});

type AcceptanceReadyRepo = {
  readonly repo: string;
  readonly captured: Extract<CaptureLocalCandidateResult, { readonly ok: true }>;
  readonly validation: ReturnType<typeof candidateValidationForTest>;
};

const runTaskBackedCandidate = (
  ready: AcceptanceReadyRepo,
  policy: TaskBackedCandidateValidationPolicy = passingValidationPolicy,
  captured = ready.captured,
) =>
  Effect.gen(function* () {
    const validation = yield* CandidateValidation;
    return yield* validation.validateTaskBackedCandidate({
      candidateId: captured.candidateId,
      comparisonBaseSha: captured.comparisonBaseSha,
      headSha: captured.headSha,
      acceptanceContext,
      policy,
      now,
    });
  }).pipe(Effect.provide(ready.validation.layer));

const acceptanceReadyRepo = (
  reviewerAgentRuntime: ReviewerAgentRuntime,
): Effect.Effect<AcceptanceReadyRepo, RepositoryStorageError> =>
  Effect.gen(function* () {
    const repo = candidateReadyRepo();
    const captured = yield* captureLocalCandidate({ cwd: repo, now });
    if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
    const validation = candidateValidationForTest({
      localRepositoryMainCheckoutRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
      reviewerAgentRuntime,
    });
    return { repo, captured, validation };
  });

const reviewerFinding = (title: string) => ({
  title,
  description: `${title} description`,
  severity: "high" as const,
  evidence: `${title} evidence`,
  files: [],
  artifactRefs: [],
});

const sqliteInput = (root: string) => candidateSqliteInput(root);
