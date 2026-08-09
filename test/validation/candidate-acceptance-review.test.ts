import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sandbox } from "@ai-hero/sandcastle";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { afterAll, beforeAll, vi } from "vitest";

import type {
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import { SandcastleToolingFailed } from "../../src/agent/reviewerExecutionFailure.js";
import { runAcceptanceReviewPhase } from "../../src/change/acceptanceReview/runAcceptanceReviewPhase.js";
import type { CaptureLocalCandidateResult } from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type { CandidateValidationPolicySnapshot } from "../../src/change/candidateValidation/candidateValidationPolicySnapshot.js";
import {
  type AcceptanceContextCandidateValidationPolicy,
  CandidateValidation,
} from "../../src/change/candidateValidation/validateCandidate.js";
import type {
  ReviewerSessionRecord,
  ReviewerSessionStore,
} from "../../src/change/reviewerSession/reviewerSession.js";
import { reviewerSessionsPath } from "../../src/change/reviewerSession/reviewerSession.js";
import { runSpecialistReviewPhase } from "../../src/change/specialistReview/runSpecialistReviewPhase.js";
import { validationToolingFailureRecord } from "../../src/change/validation/validationToolingFailures.js";
import type { AcceptanceContextSnapshotV1 } from "../../src/change/validationRun/acceptanceContextSnapshot.js";
import { maxValidationArtifactBytes } from "../../src/change/validationRun/artifactFiles.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { ReviewerOutputContractFailed } from "../../src/contracts/reviewerOutputContractFailure.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  candidateReadyRepo,
  candidateRepositoryConfig,
  commonDirectory,
  git,
} from "../support/candidateReadyRepo.js";
import { candidateValidationForTest } from "../support/candidateValidation.js";
import { cloneInitializedTestRepository } from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const now = "2026-07-15T10:00:00.000Z";
const successorNow = "2026-07-15T10:05:00.000Z";
type Captured = Extract<CaptureLocalCandidateResult, { readonly ok: true }>;
let candidateRepoTemplate: string;

beforeAll(() => {
  candidateRepoTemplate = acquireTestWorkspace();
  candidateReadyRepo(candidateRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(candidateRepoTemplate);
});

const candidateReadyRepoCopy = () => cloneInitializedTestRepository(candidateRepoTemplate);

class AcceptanceTemplate extends Context.Tag("@but-why/AcceptanceTemplate")<
  AcceptanceTemplate,
  { readonly captured: Captured }
>() {}

const acceptanceTemplateLayer = Layer.effect(
  AcceptanceTemplate,
  Effect.gen(function* () {
    const captured = yield* captureLocalCandidate({ cwd: candidateRepoTemplate, now });
    if (!captured.ok) return yield* Effect.dieMessage(`Candidate capture failed: ${captured.code}`);
    return { captured };
  }),
);

const acceptanceContext = Object.freeze({
  version: 1 as const,
  title: "Keep the exact intent",
  description: "Review the Candidate against this immutable context.",
}) satisfies AcceptanceContextSnapshotV1;

const acceptancePolicy = {
  instructions: "Repository Acceptance instructions",
  instructionsSource: "repo" as const,
  profile: {
    agentProfile: "strict",
    scope: "repo" as const,
    profile: {
      agentRuntime: "pi" as const,
      runtimeConfig: { model: "openai-codex/gpt-5.5", thinking: "high" as const },
    },
  },
};

const specialistPolicy = (id: string) => ({
  id,
  instructions: `${id} review instructions`,
  instructionsSource: "repo" as const,
  profile: acceptancePolicy.profile,
});

const passingValidationPolicy = {
  agentEnvironment: ["nix", "develop", "-c"] as const,
  checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
  copyFiles: [],
  acceptanceReview: acceptancePolicy,
  specialistReviews: [],
};

layer(acceptanceTemplateLayer)("Task-backed Candidate Acceptance Review", (it) => {
  it.scoped(
    "routes taskless Specialists without Acceptance Context through Candidate Validation",
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
        const { acceptanceReview: _acceptanceReview, ...tasklessPolicy } = passingValidationPolicy;
        const result = yield* Effect.gen(function* () {
          const validation = yield* CandidateValidation;
          return yield* validation.validateCandidate({
            changeId: ready.captured.changeId,
            candidateId: ready.captured.candidateId,
            changeBaseSha: ready.captured.changeBaseSha,
            headSha: ready.captured.headSha,
            policy: { ...tasklessPolicy, specialistReviews: [specialistPolicy("standards")] },
            now,
          });
        }).pipe(Effect.provide(ready.validation.layer));

        expect(result).toMatchObject({ ok: true, outcome: "passed" });
        expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual(["standards"]);
        expect(review.mock.calls[0]?.[0].prompt).not.toContain("authoritative scope constraint");
        expect(review.mock.calls[0]?.[0].prompt).not.toContain(acceptanceContext.description);
      }),
  );

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

        const result = yield* runFullTaskBackedCandidate(ready);

        expect(result).toMatchObject({ ok: true, reused: false, outcome: "passed" });
        if (!result.ok) return;
        expect(review).toHaveBeenCalledOnce();
        expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
          policy: { agentEnvironment: ["nix", "develop", "-c"] },
        });
        expect(review).toHaveBeenCalledWith(
          expect.objectContaining({
            reviewer: "acceptance",
            profile: acceptancePolicy.profile,
            agentEnvironment: ["nix", "develop", "-c"],
            prompt: expect.stringContaining(captured.headSha),
          }),
        );
        const prompt = review.mock.calls[0]?.[0].prompt;
        expect(prompt).toContain(result.validationRunId);
        expect(prompt).toContain(captured.changeBaseSha);
        expect(prompt).toContain(acceptanceContext.description);
        expect(prompt).toContain(acceptancePolicy.instructions);
        expect(prompt).toContain("<reviewer-output>");
        expect(yield* validation.listRounds(result.validationRunId)).toEqual([
          { producer: "quality", status: "passed" },
          { producer: "acceptance", status: "passed" },
        ]);
        expect(yield* validation.listArtifacts(result.validationRunId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: "acceptance_review", producer: "acceptance" }),
          ]),
        );
      }),
  );
  it.scoped("does not start Acceptance after a Prepare or Check Finding", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
        Effect.succeed({ ok: true as const, report: { findings: [] }, attempts: 1, stdout: "" }),
      );

      const ready = yield* acceptanceReadyRepo({ review });

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
        const result = yield* runFullTaskBackedCandidate(ready, policy);
        expect(result).toMatchObject({ ok: true, outcome: "blocked" });
      }

      expect(review).not.toHaveBeenCalled();
    }),
  );

  it.scoped("runs Repository Preparation and Checks before task-backed Acceptance Review", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime["review"]>(({ commandCwd }) =>
        Effect.sync(() => {
          if (commandCwd === undefined) throw new Error("Acceptance Review has no workspace path.");
          const gitDir = git(commandCwd, "rev-parse", "--path-format=absolute", "--git-dir");
          if (!existsSync(join(gitDir, ".but-why-check-marker")))
            throw new Error("Acceptance Review started before Checks.");
          return {
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "",
          };
        }),
      );
      const ready = yield* acceptanceReadyRepo({ review });
      const policy = {
        ...passingValidationPolicy,
        prepare: {
          command:
            'gitdir="$(git rev-parse --git-dir)"; printf prepared > "$gitdir/.but-why-prepare-marker"',
          timeoutSeconds: 1,
        },
        checks: [
          {
            id: "prepared",
            command:
              'test -f "$(git rev-parse --git-dir)/.but-why-prepare-marker" && gitdir="$(git rev-parse --git-dir)" && printf checked > "$gitdir/.but-why-check-marker"',
            timeoutSeconds: 1,
          },
        ],
      };

      const result = yield* runFullTaskBackedCandidate(ready, policy);

      expect(result).toMatchObject({ ok: true, outcome: "passed" });
      expect(review).toHaveBeenCalledOnce();
      if (!result.ok) return;
      expect(yield* ready.validation.listRounds(result.validationRunId)).toEqual([
        { producer: "prepare", status: "passed" },
        { producer: "prepared", status: "passed" },
        { producer: "acceptance", status: "passed" },
      ]);
    }),
  );

  it.scoped("records a Candidate-integrity Tooling Failure after Acceptance Review", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime["review"]>(({ commandCwd }) =>
        Effect.sync(() => {
          if (commandCwd === undefined) throw new Error("Acceptance Review has no workspace path.");
          writeFileSync(join(commandCwd, ".but-why", "config.json"), "{}");
          return {
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "",
          };
        }),
      );
      const ready = yield* acceptanceReadyRepo({ review });
      const result = yield* runFullTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(review).toHaveBeenCalledOnce();
      if (result.ok || "code" in result) return;
      expect(yield* ready.validation.listToolingFailures(result.validationRunId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationName: "verify_candidate_head" }),
        ]),
      );
      expect(git(ready.repo, "rev-parse", "HEAD")).toBe(ready.captured.headSha);
      expect(git(ready.repo, "status", "--porcelain")).toBe("");
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
                  evidence: "Observed incomplete behavior.",
                  files: ["src/first.ts"],
                  artifactRefs: [],
                },
                {
                  title: "Second mismatch",
                  description: "The second requirement is incomplete.",
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
      const findingColumns = yield* withTestRepository(
        ready.repo,
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          return yield* repository.operation(
            "inspect reviewer Finding table columns",
            (sql) =>
              sql<{ readonly name: string }>`
                PRAGMA table_info(candidate_validation_findings)
              `,
          );
        }),
      );
      expect(findingColumns.map(({ name }) => name)).not.toContain("severity");
      yield* withTestRepository(
        ready.repo,
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          yield* repository.operation(
            "seed historical reviewer Finding",
            (sql) =>
              sql`
                INSERT INTO candidate_validation_findings (
                  id, validation_run_id, phase, producer, title, description,
                  evidence, files, artifact_refs, created_at, updated_at
                ) VALUES (
                  ${`${result.validationRunId}-historical`}, ${result.validationRunId},
                  'acceptance_review', 'acceptance', 'Historical Finding',
                  'A historical reviewer Finding remains readable.',
                  'Historical evidence.', '[]', '[]', ${now}, ${now}
                )
              `,
          );
        }),
      );
      const findings = yield* validation.listFindings(result.validationRunId);
      expect(findings).toHaveLength(3);
      expect(findings.find((finding) => finding.title === "Historical Finding")).toMatchObject({
        evidence: "Historical evidence.",
      });
      expect(yield* validation.listArtifacts(result.validationRunId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("stdout.txt") }),
          expect.objectContaining({ path: expect.stringContaining("reviewer-output.json") }),
        ]),
      );
    }),
  );
  it.scoped("rechecks earlier Acceptance Findings after a blind successor review", () =>
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
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

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
      expect(review).toHaveBeenCalledTimes(2);
      expect(review.mock.calls[1]?.[0].prompt).toContain(earlierFinding.title);
      expect(review.mock.calls[1]?.[0].prompt).toContain(
        "Historical Artifact references are not current Validation Run evidence",
      );
      expect(
        (yield* ready.validation.listFindings(final.validationRunId)).map(
          (finding) => finding.title,
        ),
      ).toEqual(["Provisional new Finding"]);
      expect(
        (yield* ready.validation.listFindings(earlier.validationRunId)).map(
          (finding) => finding.title,
        ),
      ).toEqual([earlierFinding.title]);
    }),
  );

  it.scoped("rechecks earlier Acceptance Findings after a skipped successor review", () =>
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

      git(ready.repo, "commit", "--allow-empty", "-m", "intermediate checks fail");
      const intermediate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:02:00.000Z",
      });
      if (!intermediate.ok) throw new Error(`Candidate capture failed: ${intermediate.code}`);
      const skipped = yield* runFullTaskBackedCandidate(
        ready,
        {
          ...passingValidationPolicy,
          checks: [{ id: "fails", command: "false", timeoutSeconds: 1 }],
        },
        intermediate,
      );
      expect(skipped).toMatchObject({ ok: true, outcome: "blocked" });

      git(ready.repo, "commit", "--allow-empty", "-m", "final candidate");
      const successor = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: successorNow,
      });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [reviewerFinding("Provisional acceptance Finding")] },
          attempts: 1,
          stdout: "provisional acceptance report",
        }),
      );
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [reviewerFinding("Final acceptance Finding")] },
          attempts: 1,
          stdout: "final acceptance report",
        }),
      );

      const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "blocked" });
      expect(review).toHaveBeenCalledTimes(2);
    }),
  );

  it.scoped("preserves earlier Acceptance Findings after a reviewer Tooling Failure", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier acceptance Finding");
      const failure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "acceptance",
        attempts: 2,
        diagnostics: [],
        message: "Intermediate output correction failed.",
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

      git(ready.repo, "commit", "--allow-empty", "-m", "intermediate reviewer fails");
      const intermediate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:02:00.000Z",
      });
      if (!intermediate.ok) throw new Error(`Candidate capture failed: ${intermediate.code}`);
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: false,
          failure,
          sessionUsability: "unknown" as const,
          attempts: 2,
          stdout: "",
        }),
      );
      const failed = yield* runTaskBackedCandidate(ready, passingValidationPolicy, intermediate);
      expect(failed).toMatchObject({ ok: false, outcome: "tooling_failed" });

      git(ready.repo, "commit", "--allow-empty", "-m", "final candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [reviewerFinding("Provisional acceptance Finding")] },
          attempts: 1,
          stdout: "provisional acceptance report",
        }),
      );
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [reviewerFinding("Final acceptance Finding")] },
          attempts: 1,
          stdout: "final acceptance report",
        }),
      );

      const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "blocked" });
      expect(review).toHaveBeenCalledTimes(3);
    }),
  );

  it.scoped("retains a known-good Reviewer Session after a temporary tooling failure", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore: ReviewerSessionStore = {
        get: (changeId) => Effect.succeed(sessions.get(changeId)),
        save: (record) => Effect.sync(() => sessions.set(record.changeId, record)),
        remove: (changeId) => Effect.sync(() => sessions.delete(changeId)),
      };
      const temporaryFailure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "Temporary session telemetry is unavailable.",
      });
      const review = vi.fn<ReviewerAgentRuntime["review"]>((input) =>
        input.resumeSession === undefined
          ? Effect.succeed({
              ok: true as const,
              report: { findings: [] },
              attempts: 1,
              stdout: "initial acceptance report",
              sessionReference: "known-good-session",
            })
          : Effect.succeed({
              ok: false as const,
              failure: temporaryFailure,
              sessionUsability: "unknown" as const,
              attempts: 1,
              stdout: "",
            }),
      );
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const initial = yield* runTaskBackedCandidate(ready);
      expect(initial).toMatchObject({ ok: true, outcome: "passed" });

      git(ready.repo, "commit", "--allow-empty", "-m", "successor candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
      const failed = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(failed).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(review).toHaveBeenCalledTimes(2);
      expect(review.mock.calls[1]?.[0].resumeSession).toBe("known-good-session");
      expect(sessions.get(successor.changeId)?.sessionReference).toBe("known-good-session");
    }),
  );

  it.scoped(
    "uses one canonical per-producer Reviewer Session path for Acceptance and Specialists",
    () =>
      Effect.gen(function* () {
        const sessions = new Map<string, ReviewerSessionRecord>();
        const sessionStore: ReviewerSessionStore = {
          get: (changeId, producer) => Effect.succeed(sessions.get(`${changeId}/${producer}`)),
          save: (record) =>
            Effect.sync(() => sessions.set(`${record.changeId}/${record.producer}`, record)),
          remove: (changeId, producer) =>
            Effect.sync(() => sessions.delete(`${changeId}/${producer}`)),
        };
        const sessionStorageRoot = createTestWorkspace();
        const review = vi.fn<ReviewerAgentRuntime["review"]>((input) =>
          Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: `${input.reviewer} report`,
            sessionReference: `${input.reviewer}-session`,
          }),
        );
        const ready = yield* acceptanceReadyRepo(
          { review },
          { sessionStore, reviewerSessionsRoot: sessionStorageRoot },
        );
        const policy = {
          ...passingValidationPolicy,
          specialistReviews: [specialistPolicy("standards")],
        };
        const result = yield* runTaskBackedCandidate(ready, policy);

        expect(result).toMatchObject({ ok: true, outcome: "passed" });
        expect(review.mock.calls.map(([input]) => input.sessionStorageRoot)).toEqual([
          reviewerSessionsPath(sessionStorageRoot, ready.captured.changeId, "acceptance"),
          reviewerSessionsPath(sessionStorageRoot, ready.captured.changeId, "standards"),
        ]);
      }),
  );

  it.scoped(
    "starts a fresh Reviewer Session and replaces it when the identity fingerprint changes",
    () =>
      Effect.gen(function* () {
        const sessions = new Map<string, ReviewerSessionRecord>();
        const sessionStore: ReviewerSessionStore = {
          get: (changeId) => Effect.succeed(sessions.get(changeId)),
          save: (record) => Effect.sync(() => sessions.set(record.changeId, record)),
          remove: (changeId) => Effect.sync(() => sessions.delete(changeId)),
        };
        const review = vi.fn<ReviewerAgentRuntime["review"]>((input) =>
          Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "acceptance report",
            sessionReference:
              input.resumeSession === undefined ? "fresh-session" : "resumed-session",
          }),
        );
        const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
        const initial = yield* runTaskBackedCandidate(ready);
        expect(initial).toMatchObject({ ok: true, outcome: "passed" });
        const initialFingerprint = sessions.get(ready.captured.changeId)?.fingerprint;

        git(ready.repo, "commit", "--allow-empty", "-m", "changed reviewer settings");
        const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
        if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
        const changedPolicy = {
          ...passingValidationPolicy,
          acceptanceReview: {
            ...acceptancePolicy,
            instructions: "Changed Acceptance instructions",
          },
        };
        const result = yield* runTaskBackedCandidate(ready, changedPolicy, successor);

        expect(result).toMatchObject({
          ok: true,
          outcome: "passed",
          reviewerEvidence: { continuity: "restarted", reviewCalls: 1 },
        });
        expect(review.mock.calls[1]?.[0].resumeSession).toBeUndefined();
        const stored = sessions.get(successor.changeId);
        expect(stored?.sessionReference).toBe("fresh-session");
        expect(stored?.fingerprint).not.toBe(initialFingerprint);
      }),
  );

  it.scoped("preserves a fingerprint-mismatched stored session when the fresh review fails", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore: ReviewerSessionStore = {
        get: (changeId) => Effect.succeed(sessions.get(changeId)),
        save: (record) => Effect.sync(() => sessions.set(record.changeId, record)),
        remove: (changeId) => Effect.sync(() => sessions.delete(changeId)),
      };
      const freshFailure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "fresh review failed",
      });
      let calls = 0;
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() => {
        calls += 1;
        if (calls === 1)
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "initial acceptance report",
            sessionReference: "first-session",
          });
        return Effect.succeed({
          ok: false as const,
          failure: freshFailure,
          sessionUsability: "unknown" as const,
          attempts: 1,
          stdout: "",
        });
      });
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const initial = yield* runTaskBackedCandidate(ready);
      expect(initial).toMatchObject({ ok: true, outcome: "passed" });
      const initialFingerprint = sessions.get(ready.captured.changeId)?.fingerprint;

      git(ready.repo, "commit", "--allow-empty", "-m", "changed reviewer settings");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
      const changedPolicy = {
        ...passingValidationPolicy,
        acceptanceReview: {
          ...acceptancePolicy,
          instructions: "Changed Acceptance instructions",
        },
      };
      const result = yield* runTaskBackedCandidate(ready, changedPolicy, successor);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(review.mock.calls[1]?.[0].resumeSession).toBeUndefined();
      const stored = sessions.get(successor.changeId);
      expect(stored?.sessionReference).toBe("first-session");
      expect(stored?.fingerprint).toBe(initialFingerprint);
    }),
  );

  it.scoped(
    "restarts exactly once when the Reviewer Agent Runtime reports an unusable session",
    () =>
      Effect.gen(function* () {
        const sessions = new Map<string, ReviewerSessionRecord>();
        const sessionStore: ReviewerSessionStore = {
          get: (changeId) => Effect.succeed(sessions.get(changeId)),
          save: (record) => Effect.sync(() => sessions.set(record.changeId, record)),
          remove: (changeId) => Effect.sync(() => sessions.delete(changeId)),
        };
        const unusable = new SandcastleToolingFailed({
          operationName: "run_reviewer_agent",
          message: "provider detail hidden behind the runtime",
        });
        const review = vi.fn<ReviewerAgentRuntime["review"]>((input) =>
          input.resumeSession === undefined
            ? Effect.succeed({
                ok: true as const,
                report: { findings: [] },
                attempts: 1,
                stdout: "fresh acceptance report",
                sessionReference: "fresh-session",
              })
            : Effect.succeed({
                ok: false as const,
                failure: unusable,
                sessionUsability: "unusable" as const,
                attempts: 1,
                stdout: "",
              }),
        );
        const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
        const initial = yield* runTaskBackedCandidate(ready);
        expect(initial).toMatchObject({ ok: true, outcome: "passed" });

        git(ready.repo, "commit", "--allow-empty", "-m", "unusable resumed session");
        const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
        if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
        const result = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

        expect(result).toMatchObject({ ok: true, outcome: "passed" });
        expect(review).toHaveBeenCalledTimes(3);
        expect(review.mock.calls[1]?.[0].resumeSession).toBe("fresh-session");
        expect(review.mock.calls[2]?.[0].resumeSession).toBeUndefined();
        expect(sessions.get(successor.changeId)?.sessionReference).toBe("fresh-session");
      }),
  );

  it.scoped(
    "retains the superseded Reviewer Session JSONL file when a resumed session is unusable",
    () =>
      Effect.gen(function* () {
        const sessions = new Map<string, ReviewerSessionRecord>();
        const sessionStorageRoot = createTestWorkspace();
        const sessionStore: ReviewerSessionStore = {
          get: (changeId, producer) => Effect.succeed(sessions.get(`${changeId}/${producer}`)),
          save: (record) =>
            Effect.sync(() => sessions.set(`${record.changeId}/${record.producer}`, record)),
          remove: (changeId, producer) =>
            Effect.sync(() => sessions.delete(`${changeId}/${producer}`)),
        };
        const unusable = new SandcastleToolingFailed({
          operationName: "run_reviewer_agent",
          message: "provider detail hidden behind the runtime",
        });
        let freshCalls = 0;
        const review = vi.fn<ReviewerAgentRuntime["review"]>((input) => {
          if (input.resumeSession !== undefined) {
            return Effect.succeed({
              ok: false as const,
              failure: unusable,
              sessionUsability: "unusable" as const,
              attempts: 1,
              stdout: "",
            });
          }
          freshCalls += 1;
          const sessionReference = freshCalls === 1 ? "superseded-session" : "fresh-session";
          writeFileSync(
            join(
              input.sessionStorageRoot ?? sessionStorageRoot,
              `review_${sessionReference}.jsonl`,
            ),
            `{"type":"session","id":"${sessionReference}"}\n`,
          );
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "fresh acceptance report",
            sessionReference,
          });
        });
        const ready = yield* acceptanceReadyRepo(
          { review },
          { sessionStore, reviewerSessionsRoot: sessionStorageRoot },
        );
        const sessionPath = reviewerSessionsPath(
          sessionStorageRoot,
          ready.captured.changeId,
          "acceptance",
        );

        const initial = yield* runTaskBackedCandidate(ready);
        expect(initial).toMatchObject({ ok: true, outcome: "passed" });
        const supersededPath = join(sessionPath, "review_superseded-session.jsonl");
        expect(existsSync(supersededPath)).toBe(true);

        git(ready.repo, "commit", "--allow-empty", "-m", "unusable resumed session");
        const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
        if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
        const result = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

        expect(result).toMatchObject({ ok: true, outcome: "passed" });
        expect(review).toHaveBeenCalledTimes(3);
        expect(sessions.get(`${successor.changeId}/acceptance`)?.sessionReference).toBe(
          "fresh-session",
        );
        expect(existsSync(supersededPath)).toBe(true);
        expect(existsSync(join(sessionPath, "review_fresh-session.jsonl"))).toBe(true);
      }),
  );

  it.scoped("does not restart or succeed after a failed fresh review", () =>
    Effect.gen(function* () {
      const failure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "fresh review failed",
      });
      const review = vi.fn<ReviewerAgentRuntime["review"]>(() =>
        Effect.succeed({
          ok: false as const,
          failure,
          sessionUsability: "unknown" as const,
          attempts: 1,
          stdout: "",
        }),
      );
      const ready = yield* acceptanceReadyRepo({ review });

      const result = yield* runTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(review).toHaveBeenCalledOnce();
    }),
  );

  it.scoped("clears earlier Acceptance Findings after a later clean report", () =>
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

      git(ready.repo, "commit", "--allow-empty", "-m", "clean acceptance candidate");
      const cleanCandidate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:02:00.000Z",
      });
      if (!cleanCandidate.ok) throw new Error(`Candidate capture failed: ${cleanCandidate.code}`);
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [] },
          attempts: 1,
          stdout: "provisional clean acceptance report",
        }),
      );
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [] },
          attempts: 1,
          stdout: "final clean acceptance report",
        }),
      );
      const clean = yield* runTaskBackedCandidate(ready, passingValidationPolicy, cleanCandidate);
      expect(clean).toMatchObject({ ok: true, outcome: "passed" });

      git(ready.repo, "commit", "--allow-empty", "-m", "successor acceptance candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [] },
          attempts: 1,
          stdout: "successor clean acceptance report",
        }),
      );

      const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "passed" });
      expect(review).toHaveBeenCalledTimes(3);
    }),
  );

  it.scoped("rechecks earlier Specialist Findings after a blind successor review", () =>
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
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const final = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "blocked" });
      expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
        "acceptance",
        "standards",
        "acceptance",
        "standards",
        "standards",
      ]);
      expect(review.mock.calls[3]?.[0].prompt).not.toContain(earlierFinding.title);
      const finalPrompt = review.mock.calls[4]?.[0].prompt;
      expect(finalPrompt).toContain("Provisional specialist Finding");
      expect(finalPrompt).toContain(earlierFinding.title);
      expect(finalPrompt).not.toContain(earlier.validationRunId);
      expect(
        JSON.parse(
          readFileSync(
            join(
              commonDirectory(ready.repo),
              "but-why",
              "artifacts",
              final.validationRunId,
              "specialist_review",
              "standards",
              "execution.json",
            ),
            "utf8",
          ),
        ),
      ).toMatchObject({ reviewCalls: 2 });
      expect(
        (yield* ready.validation.listFindings(final.validationRunId)).map(
          (finding) => finding.title,
        ),
      ).toEqual(["Final specialist Finding"]);
      expect(
        (yield* ready.validation.listFindings(earlier.validationRunId)).map(
          (finding) => finding.title,
        ),
      ).toEqual([earlierFinding.title]);
    }),
  );

  it.scoped("fails tooling when the Specialist revision call fails after earlier Findings", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier specialist Finding");
      const revisionFailure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "Specialist revision call failed.",
      });
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
          ok: false,
          failure: revisionFailure,
          sessionUsability: "unknown",
          attempts: 2,
          stdout: "revision standards failure",
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
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const final = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(final).toMatchObject({ ok: false, outcome: "tooling_failed" });
      if (final.ok || "code" in final) return;
      expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
        "acceptance",
        "standards",
        "acceptance",
        "standards",
        "standards",
      ]);
      const revisionPrompt = review.mock.calls[4]?.[0].prompt;
      expect(revisionPrompt).toContain("Provisional specialist Finding");
      expect(revisionPrompt).toContain(earlierFinding.title);
      expect(
        JSON.parse(
          readFileSync(
            join(
              commonDirectory(ready.repo),
              "but-why",
              "artifacts",
              final.validationRunId,
              "specialist_review",
              "standards",
              "execution.json",
            ),
            "utf8",
          ),
        ),
      ).toMatchObject({ reviewCalls: 2 });
      expect(yield* ready.validation.listFindings(final.validationRunId)).toEqual([]);
      expect(
        (yield* ready.validation.listToolingFailures(final.validationRunId)).map(
          (failure) => failure.errorMessage,
        ),
      ).toEqual(["Specialist revision call failed."]);
      expect(yield* ready.validation.listRounds(final.validationRunId)).toEqual([
        { producer: "quality", status: "passed" },
        { producer: "acceptance", status: "passed" },
        { producer: "standards", status: "failed" },
      ]);
    }),
  );

  it.scoped("rechecks earlier Specialist Findings after a skipped successor review", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier specialist Finding");
      const reports: readonly ReviewerAgentResult[] = [
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted" },
        {
          ok: true,
          report: { findings: [earlierFinding] },
          attempts: 1,
          stdout: "earlier specialist report",
        },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "final accepted" },
        {
          ok: true,
          report: { findings: [reviewerFinding("Provisional specialist Finding")] },
          attempts: 1,
          stdout: "provisional specialist report",
        },
        {
          ok: true,
          report: { findings: [reviewerFinding("Final specialist Finding")] },
          attempts: 1,
          stdout: "final specialist report",
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

      git(ready.repo, "commit", "--allow-empty", "-m", "intermediate checks fail");
      const intermediate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:02:00.000Z",
      });
      if (!intermediate.ok) throw new Error(`Candidate capture failed: ${intermediate.code}`);
      const skipped = yield* runFullTaskBackedCandidate(
        ready,
        { ...policy, checks: [{ id: "fails", command: "false", timeoutSeconds: 1 }] },
        intermediate,
      );
      expect(skipped).toMatchObject({ ok: true, outcome: "blocked" });

      git(ready.repo, "commit", "--allow-empty", "-m", "final candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
      const final = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "blocked" });
      expect(review).toHaveBeenCalledTimes(5);
      expect(review.mock.calls[3]?.[0].prompt).not.toContain(earlierFinding.title);
      expect(review.mock.calls[4]?.[0].prompt).toContain(earlierFinding.title);
    }),
  );

  it.scoped("preserves and clears Specialist Findings across invalid and clean reports", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier specialist Finding");
      const failure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "standards",
        attempts: 2,
        diagnostics: [],
        message: "Intermediate specialist output correction failed.",
      });
      const reports: readonly ReviewerAgentResult[] = [
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted 1" },
        {
          ok: true,
          report: { findings: [earlierFinding] },
          attempts: 1,
          stdout: "specialist 1",
        },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted 2" },
        {
          ok: false,
          failure,
          sessionUsability: "unknown",
          attempts: 2,
          stdout: "invalid specialist output",
        },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted 3" },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "provisional specialist 3" },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "final specialist 3" },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "accepted 4" },
        { ok: true, report: { findings: [] }, attempts: 1, stdout: "specialist 4" },
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

      const first = yield* runTaskBackedCandidate(ready, policy);
      expect(first).toMatchObject({ ok: true, outcome: "blocked" });
      if (!first.ok) return;

      git(ready.repo, "commit", "--allow-empty", "-m", "intermediate specialist fails");
      const intermediate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:02:00.000Z",
      });
      if (!intermediate.ok) throw new Error(`Candidate capture failed: ${intermediate.code}`);
      const failed = yield* runTaskBackedCandidate(ready, policy, intermediate);
      expect(failed).toMatchObject({ ok: false, outcome: "tooling_failed" });

      git(ready.repo, "commit", "--allow-empty", "-m", "clean specialist candidate");
      const clean = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:04:00.000Z",
      });
      if (!clean.ok) throw new Error(`Candidate capture failed: ${clean.code}`);
      const cleanResult = yield* runTaskBackedCandidate(ready, policy, clean);
      expect(cleanResult).toMatchObject({ ok: true, outcome: "passed" });

      git(ready.repo, "commit", "--allow-empty", "-m", "successor specialist candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
      const final = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "passed" });
      expect(review).toHaveBeenCalledTimes(9);
      expect(review.mock.calls[5]?.[0].prompt).not.toContain(earlierFinding.title);
      expect(review.mock.calls[6]?.[0].prompt).toContain(earlierFinding.title);
      expect(review.mock.calls[8]?.[0].prompt).not.toContain(earlierFinding.title);
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
            broken: {
              ok: false,
              failure,
              sessionUsability: "unknown",
              attempts: 2,
              stdout: "invalid",
            },
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
          expect(input.agentEnvironment).toEqual(["nix", "develop", "-c"]);
          expect(input.availableArtifactRefs).toEqual(
            expect.arrayContaining([expect.stringContaining("/checks/quality/")]),
          );
          expect(input.prompt).toContain(ready.captured.changeBaseSha);
          expect(input.prompt).toContain(ready.captured.headSha);
          expect(input.prompt).toContain(`${input.reviewer} review instructions`);
          expect(input.prompt).toContain("/checks/quality/");
          expect(input.prompt).not.toContain(ready.captured.candidateId);
          expect(input.prompt).toContain(acceptanceContext.description);
        }
        expect(
          (yield* ready.validation.listFindings(result.validationRunId)).map((item) => item.title),
        ).toEqual(["Zeta Finding", "Alpha Finding"]);
        expect(yield* ready.validation.listRounds(result.validationRunId)).toEqual([
          { producer: "quality", status: "passed" },
          { producer: "acceptance", status: "passed" },
          { producer: "zeta", status: "failed" },
          { producer: "broken", status: "failed" },
          { producer: "alpha", status: "failed" },
        ]);
        expect(yield* ready.validation.listToolingFailures(result.validationRunId)).toEqual([
          expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
        ]);
        expect(yield* ready.validation.listArtifacts(result.validationRunId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: "specialist_review", producer: "zeta" }),
            expect.objectContaining({ phase: "specialist_review", producer: "broken" }),
            expect.objectContaining({ phase: "specialist_review", producer: "alpha" }),
          ]),
        );
      }),
  );
  it.scoped("records a configured reviewer launch failure as a Validation Tooling Failure", () =>
    Effect.gen(function* () {
      const failure = new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: "wrapper failed",
      });
      let calls = 0;
      const ready = yield* acceptanceReadyRepo({
        review: (input) => {
          calls += 1;
          expect(input.agentEnvironment).toEqual(["nix", "develop", "-c"]);
          return Effect.succeed({
            ok: false,
            failure,
            sessionUsability: "unknown" as const,
            attempts: 1,
            stdout: "",
          });
        },
      });

      const result = yield* runTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(calls).toBe(1);
      expect(yield* ready.validation.listToolingFailures(result.validationRunId)).toEqual([
        expect.objectContaining({
          errorKind: "sandcastle_tooling_failed",
          operationName: "run_reviewer_agent",
        }),
      ]);
      expect(yield* ready.validation.listRounds(result.validationRunId)).toEqual([
        { producer: "quality", status: "passed" },
        { producer: "acceptance", status: "failed" },
      ]);
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
        review: () =>
          Effect.succeed({
            ok: false,
            failure,
            sessionUsability: "unknown" as const,
            attempts: 2,
            stdout: "invalid output",
          }),
      });
      const { validation } = ready;

      const result = yield* runTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(yield* validation.listFindings(result.validationRunId)).toEqual([]);
      expect(yield* validation.listToolingFailures(result.validationRunId)).toEqual([
        expect.objectContaining({ errorKind: "reviewer_output_contract_failed" }),
      ]);
      expect(yield* validation.listArtifacts(result.validationRunId)).toContainEqual(
        expect.objectContaining({ phase: "acceptance_review", producer: "acceptance" }),
      );
    }),
  );

  it.scoped("restarts one unusable Specialist Reviewer Session for one fresh success", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore = specialistSessionStore(sessions);
      const unusable = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "standards",
        attempts: 1,
        diagnostics: [],
        message: "Session resume failed: provider detail hidden behind the runtime",
      });
      let specialistCalls = 0;
      const review = vi.fn<ReviewerAgentRuntime["review"]>((input) => {
        if (input.reviewer === "acceptance")
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "acceptance report",
          });
        specialistCalls += 1;
        if (specialistCalls === 1)
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "initial specialist report",
            sessionReference: "old-session",
          });
        if (input.resumeSession !== undefined)
          return Effect.succeed({
            ok: false as const,
            failure: unusable,
            sessionUsability: "unusable" as const,
            attempts: 1,
            stdout: "resumed specialist failure",
          });
        return Effect.succeed({
          ok: true as const,
          report: { findings: [] },
          attempts: 1,
          stdout: "fresh specialist report",
          sessionReference: "fresh-session",
        });
      });
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const policy = {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("standards")],
      };

      const initial = yield* runTaskBackedCandidate(ready, policy);
      expect(initial).toMatchObject({ ok: true, outcome: "passed" });
      git(ready.repo, "commit", "--allow-empty", "-m", "unusable specialist session");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const result = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(result).toMatchObject({
        ok: true,
        outcome: "passed",
        specialistReviewerEvidence: [
          { producer: "standards", continuity: "restarted", reviewCalls: 2 },
        ],
      });
      expect(specialistCalls).toBe(3);
      expect(
        review.mock.calls
          .filter(([input]) => input.reviewer === "standards")
          .map(([input]) => input.resumeSession),
      ).toEqual([undefined, "old-session", undefined]);
      expect(sessions.get(`${successor.changeId}/standards`)?.sessionReference).toBe(
        "fresh-session",
      );
    }),
  );

  it.scoped("does not restart after an unusable Specialist fresh call fails", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore = specialistSessionStore(sessions);
      const unusable = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "standards",
        attempts: 1,
        diagnostics: [],
        message: "resumed session is unusable",
      });
      const freshFailure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "standards",
        attempts: 1,
        diagnostics: [],
        message: "fresh Specialist review failed",
      });
      let specialistCalls = 0;
      const review = vi.fn<ReviewerAgentRuntime["review"]>((input) => {
        if (input.reviewer === "acceptance")
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "acceptance report",
          });
        specialistCalls += 1;
        if (specialistCalls === 1)
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "initial specialist report",
            sessionReference: "old-session",
          });
        return Effect.succeed({
          ok: false as const,
          failure: specialistCalls === 2 ? unusable : freshFailure,
          sessionUsability: specialistCalls === 2 ? ("unusable" as const) : ("unknown" as const),
          attempts: 1,
          stdout: "failed specialist report",
        });
      });
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const policy = {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("standards")],
      };
      const initial = yield* runTaskBackedCandidate(ready, policy);
      expect(initial).toMatchObject({ ok: true, outcome: "passed" });
      git(ready.repo, "commit", "--allow-empty", "-m", "failed fresh specialist review");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const result = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(specialistCalls).toBe(3);
      expect(yield* ready.validation.listFindings(result.validationRunId)).toEqual([]);
      expect(sessions.get(`${successor.changeId}/standards`)).toBeUndefined();
    }),
  );

  it.scoped("preserves a Specialist Reviewer Session after an unknown resumed failure", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore = specialistSessionStore(sessions);
      const temporaryFailure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "standards",
        attempts: 1,
        diagnostics: [],
        message: "Temporary failure classified as unknown",
      });
      let specialistCalls = 0;
      const review = vi.fn<ReviewerAgentRuntime["review"]>((input) => {
        if (input.reviewer === "acceptance")
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "acceptance report",
          });
        specialistCalls += 1;
        if (specialistCalls === 1)
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "initial specialist report",
            sessionReference: "known-session",
          });
        return Effect.succeed({
          ok: false as const,
          failure: temporaryFailure,
          sessionUsability: "unknown" as const,
          attempts: 1,
          stdout: "temporary specialist failure",
        });
      });
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const policy = {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("standards")],
      };
      const initial = yield* runTaskBackedCandidate(ready, policy);
      expect(initial).toMatchObject({ ok: true, outcome: "passed" });
      git(ready.repo, "commit", "--allow-empty", "-m", "unknown specialist failure");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const result = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(specialistCalls).toBe(2);
      expect(review.mock.calls.filter(([input]) => input.reviewer === "standards")).toHaveLength(2);
      expect(sessions.get(`${successor.changeId}/standards`)?.sessionReference).toBe(
        "known-session",
      );
      expect(yield* ready.validation.listFindings(result.validationRunId)).toEqual([]);
    }),
  );

  it.scoped("keeps Specialist restarts and sessions independent", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore = specialistSessionStore(sessions);
      const alphaFailure = new ReviewerOutputContractFailed({
        operationName: "decode_reviewer_output",
        reviewer: "alpha",
        attempts: 1,
        diagnostics: [],
        message: "alpha resumed session failure",
      });
      let alphaCalls = 0;
      const review = vi.fn<ReviewerAgentRuntime["review"]>((input) => {
        if (input.reviewer === "acceptance")
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "acceptance report",
          });
        if (input.reviewer === "alpha") {
          alphaCalls += 1;
          if (input.resumeSession !== undefined)
            return Effect.succeed({
              ok: false as const,
              failure: alphaFailure,
              sessionUsability: "unusable" as const,
              attempts: 1,
              stdout: "alpha resumed failure",
            });
          return Effect.succeed({
            ok: true as const,
            report: { findings: [] },
            attempts: 1,
            stdout: "alpha report",
            sessionReference: alphaCalls === 1 ? "alpha-session" : "alpha-fresh-session",
          });
        }
        return Effect.succeed({
          ok: true as const,
          report: { findings: [] },
          attempts: 1,
          stdout: "beta report",
          sessionReference: "beta-session",
        });
      });
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const policy = {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("alpha"), specialistPolicy("beta")],
      };
      const initial = yield* runTaskBackedCandidate(ready, policy);
      expect(initial).toMatchObject({ ok: true, outcome: "passed" });
      git(ready.repo, "commit", "--allow-empty", "-m", "independent specialist sessions");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const result = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(result).toMatchObject({
        ok: true,
        outcome: "passed",
        specialistReviewerEvidence: [
          { producer: "alpha", continuity: "restarted", reviewCalls: 2 },
          { producer: "beta", continuity: "resumed", reviewCalls: 1 },
        ],
      });
      expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
        "acceptance",
        "alpha",
        "beta",
        "acceptance",
        "alpha",
        "alpha",
        "beta",
      ]);
      expect(sessions.get(`${successor.changeId}/alpha`)?.sessionReference).toBe(
        "alpha-fresh-session",
      );
      expect(sessions.get(`${successor.changeId}/beta`)?.sessionReference).toBe("beta-session");
    }),
  );

  it.scoped("continues independent Specialist Reviewer Sessions in configured order", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore: ReviewerSessionStore = {
        get: (changeId, producer) => Effect.succeed(sessions.get(`${changeId}/${producer}`)),
        save: (record) =>
          Effect.sync(() => sessions.set(`${record.changeId}/${record.producer}`, record)),
        remove: (changeId, producer) =>
          Effect.sync(() => sessions.delete(`${changeId}/${producer}`)),
      };
      const review = vi.fn<ReviewerAgentRuntime["review"]>((input) =>
        Effect.succeed({
          ok: true as const,
          report: { findings: [] },
          attempts: 1,
          stdout: `${input.reviewer} report`,
          sessionReference: `${input.reviewer}-session`,
        }),
      );
      const ready = yield* acceptanceReadyRepo({ review }, { sessionStore });
      const policy = {
        ...passingValidationPolicy,
        specialistReviews: [specialistPolicy("alpha"), specialistPolicy("beta")],
      };

      const first = yield* runTaskBackedCandidate(ready, policy);
      expect(first).toMatchObject({ ok: true, outcome: "passed" });
      if (!first.ok) return;

      git(ready.repo, "commit", "--allow-empty", "-m", "successor specialist candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
      const second = yield* runTaskBackedCandidate(ready, policy, successor);

      expect(second).toMatchObject({
        ok: true,
        outcome: "passed",
        specialistReviewerEvidence: [
          { producer: "alpha", continuity: "resumed" },
          { producer: "beta", continuity: "resumed" },
        ],
      });
      expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual([
        "acceptance",
        "alpha",
        "beta",
        "acceptance",
        "alpha",
        "beta",
      ]);
      expect(review.mock.calls.map(([input]) => input.resumeSession)).toEqual([
        undefined,
        undefined,
        undefined,
        "acceptance-session",
        "alpha-session",
        "beta-session",
      ]);
      for (const [input] of review.mock.calls.filter(([call]) => call.reviewer !== "acceptance")) {
        expect(input.prompt).toContain(acceptanceContext.description);
        if (input.reviewer === "alpha")
          expect(input.prompt).not.toContain("beta review instructions");
        if (input.reviewer === "beta")
          expect(input.prompt).not.toContain("alpha review instructions");
      }
      expect(sessions.get(`${successor.changeId}/alpha`)?.sessionReference).toBe("alpha-session");
      expect(sessions.get(`${successor.changeId}/beta`)?.sessionReference).toBe("beta-session");
    }),
  );
});

type AcceptanceReadyRepo = {
  readonly repo: string;
  readonly captured: Captured;
  readonly validation: ReturnType<typeof candidateValidationForTest>;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime;
  readonly sessionStore?: ReviewerSessionStore;
  readonly reviewerSessionsRoot?: string;
};

const runFullTaskBackedCandidate = (
  ready: AcceptanceReadyRepo,
  policy: AcceptanceContextCandidateValidationPolicy = passingValidationPolicy,
  captured = ready.captured,
) =>
  Effect.gen(function* () {
    const validation = yield* CandidateValidation;
    return yield* validation.validateAcceptanceContextCandidate({
      changeId: captured.changeId,
      candidateId: captured.candidateId,
      changeBaseSha: captured.changeBaseSha,
      headSha: captured.headSha,
      acceptanceContext,
      policy,
      now,
    });
  }).pipe(Effect.provide(ready.validation.layer));

const runTaskBackedCandidate = (
  ready: AcceptanceReadyRepo,
  policy: AcceptanceContextCandidateValidationPolicy = passingValidationPolicy,
  captured = ready.captured,
) => runReviewPhases(ready, policy, captured);

const runReviewPhases = (
  ready: AcceptanceReadyRepo,
  policy: AcceptanceContextCandidateValidationPolicy,
  captured: Captured,
) =>
  ready.validation.runWithPersistence((persistence) =>
    Effect.gen(function* () {
      const policySnapshot: CandidateValidationPolicySnapshot = { ...policy, acceptanceContext };
      const started = yield* persistence.startOrReuse({
        candidateId: captured.candidateId,
        headSha: captured.headSha,
        changeBaseSha: captured.changeBaseSha,
        policy: policySnapshot,
        now,
      });
      if (started.reused) return { ok: true as const, ...started, outcome: "passed" as const };
      if ("blocked" in started) {
        throw new Error("Unexpected active Blocker in Acceptance Review fixture");
      }

      yield* persistence.recordCheckRound({
        validationRunId: started.validationRunId,
        producer: "quality",
        roundNumber: 1,
        roundStatus: "passed",
        artifactRecords: [
          {
            ref: `artifact:${started.validationRunId}/checks/quality/stdout.txt`,
            validationRunId: started.validationRunId,
            phase: "checks",
            producer: "quality",
            path: "stdout.txt",
            originalBytes: 0,
            storedBytes: 0,
            truncated: false,
          },
        ],
        now,
      });
      const sandbox: Pick<Sandbox, "exec" | "run"> = {
        exec: async () => ({ exitCode: 0, stdout: `${captured.headSha}\n`, stderr: "" }),
        run: async () => {
          throw new Error("Reviewer test runtime must not call Sandbox.run");
        },
      };
      const acceptance = yield* runAcceptanceReviewPhase({
        validationRunId: started.validationRunId,
        changeId: captured.changeId,
        candidate: {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        },
        acceptanceContext,
        implementationDecisions: undefined,
        policy: policy.acceptanceReview,
        ...(policy.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: policy.agentEnvironment }),
        runtime: ready.reviewerAgentRuntime,
        ...(ready.sessionStore === undefined ? {} : { sessionStore: ready.sessionStore }),
        ...(ready.reviewerSessionsRoot === undefined
          ? {}
          : { sessionStorageRoot: ready.reviewerSessionsRoot }),
        sandbox,
        artifactsRoot: join(commonDirectory(ready.repo), "but-why", "artifacts"),
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: ready.repo,
        resourceRoot: ready.repo,
        allowedUntrackedFiles: [],
        now,
        listArtifacts: persistence.listArtifacts,
        listPreviousCandidateReviewerFindings: persistence.listPreviousCandidateReviewerFindings,
        recordAcceptanceRound: persistence.recordAcceptanceRound,
      });
      if (acceptance.toolingFailure !== undefined) {
        yield* persistence.recordToolingFailure({
          validationRunId: started.validationRunId,
          ...validationToolingFailureRecord(acceptance.toolingFailure),
          now,
        });
        yield* persistence.complete({
          validationRunId: started.validationRunId,
          outcome: "tooling_failed",
          now,
        });
        return {
          ok: false as const,
          validationRunId: started.validationRunId,
          outcome: "tooling_failed" as const,
        };
      }
      if (acceptance.findings === 1) {
        yield* persistence.complete({
          validationRunId: started.validationRunId,
          outcome: "blocked",
          now,
        });
        return {
          ok: true as const,
          reused: false as const,
          validationRunId: started.validationRunId,
          outcome: "blocked" as const,
        };
      }
      if (policy.specialistReviews.length === 0) {
        yield* persistence.complete({
          validationRunId: started.validationRunId,
          outcome: "passed",
          now,
        });
        return {
          ok: true as const,
          reused: false as const,
          validationRunId: started.validationRunId,
          outcome: "passed" as const,
          ...(acceptance.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: acceptance.reviewerEvidence }),
        };
      }
      const specialists = yield* runSpecialistReviewPhase({
        validationRunId: started.validationRunId,
        changeId: captured.changeId,
        candidate: {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        },
        policies: policy.specialistReviews,
        acceptanceContext,
        ...(policy.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: policy.agentEnvironment }),
        runtime: ready.reviewerAgentRuntime,
        ...(ready.sessionStore === undefined ? {} : { sessionStore: ready.sessionStore }),
        ...(ready.reviewerSessionsRoot === undefined
          ? {}
          : { sessionStorageRoot: ready.reviewerSessionsRoot }),
        sandbox,
        artifactsRoot: join(commonDirectory(ready.repo), "but-why", "artifacts"),
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: ready.repo,
        resourceRoot: ready.repo,
        allowedUntrackedFiles: [],
        now,
        listArtifacts: persistence.listArtifacts,
        listPreviousCandidateReviewerFindings: persistence.listPreviousCandidateReviewerFindings,
        recordSpecialistRound: persistence.recordSpecialistRound,
      });
      for (const toolingFailure of specialists.toolingFailures) {
        yield* persistence.recordToolingFailure({
          validationRunId: started.validationRunId,
          ...validationToolingFailureRecord(toolingFailure),
          now,
        });
      }
      const outcome =
        specialists.toolingFailures.length > 0
          ? "tooling_failed"
          : specialists.findings === 1
            ? "blocked"
            : "passed";
      yield* persistence.complete({ validationRunId: started.validationRunId, outcome, now });
      return outcome === "tooling_failed"
        ? {
            ok: false as const,
            validationRunId: started.validationRunId,
            outcome: "tooling_failed" as const,
            ...(acceptance.reviewerEvidence === undefined
              ? {}
              : { reviewerEvidence: acceptance.reviewerEvidence }),
            specialistReviewerEvidence: specialists.reviewerEvidence,
          }
        : {
            ok: true as const,
            reused: false as const,
            validationRunId: started.validationRunId,
            outcome,
            ...(acceptance.reviewerEvidence === undefined
              ? {}
              : { reviewerEvidence: acceptance.reviewerEvidence }),
            specialistReviewerEvidence: specialists.reviewerEvidence,
          };
    }),
  );

const specialistSessionStore = (
  sessions: Map<string, ReviewerSessionRecord>,
): ReviewerSessionStore => ({
  get: (changeId, producer) => Effect.succeed(sessions.get(`${changeId}/${producer}`)),
  save: (record) =>
    Effect.sync(() => sessions.set(`${record.changeId}/${record.producer}`, record)),
  remove: (changeId, producer) => Effect.sync(() => sessions.delete(`${changeId}/${producer}`)),
});

const acceptanceReadyRepo = (
  reviewerAgentRuntime: ReviewerAgentRuntime,
  session?: {
    readonly sessionStore?: ReviewerSessionStore;
    readonly reviewerSessionsRoot?: string;
  },
): Effect.Effect<AcceptanceReadyRepo, RepositoryStorageError, AcceptanceTemplate> =>
  Effect.gen(function* () {
    const template = yield* AcceptanceTemplate;
    const repo = yield* candidateReadyRepoCopy();
    const captured = template.captured;
    const validation = candidateValidationForTest({
      localRepositoryMainCheckoutRoot: repo,
      artifactsRoot: join(commonDirectory(repo), "but-why", "artifacts"),
      repository: repositoryConfig(repo),
      reviewerAgentRuntime,
      ...(session === undefined ? {} : session),
    });
    return {
      repo,
      captured,
      validation,
      reviewerAgentRuntime,
      ...(session === undefined ? {} : session),
    };
  });

const repositoryConfig = (root: string) => ({
  statePath: candidateRepositoryConfig(root).statePath,
  commonDirectory: commonDirectory(root),
});

const reviewerFinding = (title: string) => ({
  title,
  description: `${title} description`,
  evidence: `${title} evidence`,
  files: [],
  artifactRefs: [],
});
