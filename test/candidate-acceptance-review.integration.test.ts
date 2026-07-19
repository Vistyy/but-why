import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../src/agent/reviewerAgentRuntime.js";
import { captureLocalCandidate } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import {
  openCandidateValidation,
  type TaskBackedCandidateValidationPolicy,
} from "../src/candidateValidation/validateCandidate.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { ReviewerOutputContractFailed } from "../src/validation/validationToolingFailures.js";
import type { TaskContextSnapshotV1 } from "../src/validationRun/taskContextSnapshot.js";
import { cleanupTempRoots } from "./support/by-cli.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
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

afterEach(cleanupTempRoots);

describe("Task-backed Candidate Acceptance Review", () => {
  it("reviews the exact Candidate and immutable Acceptance Context after passing Checks", async () => {
    const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
      Effect.succeed({
        ok: true as const,
        report: { findings: [] },
        attempts: 1,
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
      }),
    );
    const ready = acceptanceReadyRepo({ review });
    const { captured, validation } = ready;

    const result = await runTaskBackedCandidate(ready);

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
  });

  it("does not start Acceptance after a Prepare or Check Finding", async () => {
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
      const ready = acceptanceReadyRepo({ review });
      await expect(runTaskBackedCandidate(ready, policy)).resolves.toMatchObject({
        ok: true,
        outcome: "blocked",
      });
    }

    expect(review).not.toHaveBeenCalled();
  });

  it("blocks on every Acceptance Finding and stores reviewer evidence", async () => {
    const ready = acceptanceReadyRepo({
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

    const result = await runTaskBackedCandidate(ready);

    expect(result).toMatchObject({ ok: true, outcome: "blocked" });
    expect(validation.listFindings(result.validationRunId)).toHaveLength(2);
    expect(validation.listArtifacts(result.validationRunId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("stdout.txt") }),
        expect.objectContaining({ path: expect.stringContaining("reviewer-output.json") }),
      ]),
    );
  });

  it("runs configured Specialists once and keeps trustworthy results in configured order", async () => {
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
    const ready = acceptanceReadyRepo({ review });

    const result = await runTaskBackedCandidate(ready, {
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
    expect(ready.validation.listFindings(result.validationRunId).map((item) => item.title)).toEqual(
      ["Zeta Finding", "Alpha Finding"],
    );
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
  });

  it("blocks the Candidate on a Specialist Finding", async () => {
    const ready = acceptanceReadyRepo({
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

    await expect(
      runTaskBackedCandidate(ready, {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("standards")],
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "blocked" });
  });

  it("records structured-output exhaustion as tooling failure without a Finding", async () => {
    const failure = new ReviewerOutputContractFailed({
      operationName: "decode_reviewer_output",
      reviewer: "acceptance",
      attempts: 2,
      diagnostics: [],
      message: "Structured output correction failed.",
    });
    const ready = acceptanceReadyRepo({
      review: () => Effect.succeed({ ok: false, failure, attempts: 2, stdout: "invalid output" }),
    });
    const { validation } = ready;

    const result = await runTaskBackedCandidate(ready);

    expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
    expect(validation.listFindings(result.validationRunId)).toEqual([]);
    expect(validation.listToolingFailures(result.validationRunId)).toEqual([
      expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
    ]);
    expect(validation.listArtifacts(result.validationRunId)).toContainEqual(
      expect.objectContaining({ phase: "acceptance_review", producer: "acceptance" }),
    );
  });
});

const runTaskBackedCandidate = (
  ready: ReturnType<typeof acceptanceReadyRepo>,
  policy: TaskBackedCandidateValidationPolicy = passingValidationPolicy,
) =>
  Effect.runPromise(
    ready.validation.validateTaskBackedCandidate({
      candidateId: ready.captured.candidateId,
      comparisonBaseSha: ready.captured.comparisonBaseSha,
      headSha: ready.captured.headSha,
      acceptanceContext,
      policy,
      now,
    }),
  );

const acceptanceReadyRepo = (reviewerAgentRuntime: ReviewerAgentRuntime) => {
  const repo = candidateReadyRepo();
  const captured = captureLocalCandidate({ cwd: repo, now });
  if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
  const validation = openCandidateValidation({
    localRepositoryMainCheckoutRoot: repo,
    artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
    runStore: openSqliteCandidateValidationRunStore(sqliteInput(repo)),
    reviewerAgentRuntime,
  });
  return { captured, validation };
};

const sqliteInput = (root: string) => candidateSqliteInput(root, now);
