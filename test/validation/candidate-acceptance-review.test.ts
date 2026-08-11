import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { afterAll, beforeAll, vi } from "vitest";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../src/agent/reviewerExecution.js";
import { runAcceptanceReviewPhase } from "../../src/change/acceptanceReview/runAcceptanceReviewPhase.js";
import type { CaptureLocalCandidateResult } from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type { CandidateValidationPolicySnapshot } from "../../src/change/candidateValidation/candidateValidationPolicySnapshot.js";
import type { AcceptanceContextCandidateValidationPolicy } from "../../src/change/candidateValidation/validateCandidate.js";
import type { ReviewerSessionStore } from "../../src/change/reviewerSession/reviewerSession.js";
import { validationToolingFailureRecord } from "../../src/change/validation/validationToolingFailures.js";
import type { AcceptanceContextSnapshotV1 } from "../../src/change/validationRun/acceptanceContextSnapshot.js";
import { maxValidationArtifactBytes } from "../../src/change/validationRun/artifactFiles.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import type { ReviewerOutput } from "../../src/contracts/reviewerOutput.js";
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
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const unusedReviewerExecutor: ReviewerProcessExecutor = {
  execute: () => Effect.die("Reviewer test runtime must not execute a reviewer process."),
};

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

const passingValidationPolicy = {
  agentEnvironment: ["nix", "develop", "-c"] as const,
  checks: [{ id: "quality", command: "true", timeoutSeconds: 1 }],
  copyFiles: [],
  acceptanceReview: acceptancePolicy,
  specialistReviews: [],
};

layer(acceptanceTemplateLayer)("Task-backed Candidate Acceptance Review", (it) => {
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
      expect(yield* validation.getRun(result.validationRunId)).toMatchObject({
        state: "complete",
        outcome: "blocked",
      });
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
  it.scoped("persists a reviewer Tooling Failure without an Acceptance Finding", () =>
    Effect.gen(function* () {
      const ready = yield* acceptanceReadyRepo({
        review: () =>
          Effect.succeed({
            ok: false,
            failure: new ReviewerExecutionFailed({
              kind: "process_execution",
              operationName: "run_reviewer_process",
              message: "Reviewer launch failed.",
            }),
            sessionUsability: "unknown" as const,
            attempts: 1,
            stdout: "",
          }),
      });

      const result = yield* runTaskBackedCandidate(ready);

      expect(result).toMatchObject({ ok: false, outcome: "tooling_failed" });
      expect(yield* ready.validation.listFindings(result.validationRunId)).toEqual([]);
      expect(yield* ready.validation.listToolingFailures(result.validationRunId)).toEqual([
        expect.objectContaining({
          errorKind: "reviewer_process_execution_failed",
          operationName: "run_reviewer_process",
        }),
      ]);
      expect(yield* ready.validation.listRounds(result.validationRunId)).toEqual([
        { producer: "quality", status: "passed" },
        { producer: "acceptance", status: "failed" },
      ]);
    }),
  );

  it.scoped("preserves earlier Acceptance Findings through failure until a clean report", () =>
    Effect.gen(function* () {
      const earlierFinding = reviewerFinding("Earlier acceptance Finding");
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
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

      git(ready.repo, "commit", "--allow-empty", "-m", "failed acceptance candidate");
      const failedCandidate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:01:00.000Z",
      });
      if (!failedCandidate.ok) throw new Error(`Candidate capture failed: ${failedCandidate.code}`);
      review.mockImplementationOnce(() =>
        Effect.succeed({
          ok: false,
          failure: new ReviewerExecutionFailed({
            kind: "process_execution",
            operationName: "run_reviewer_process",
            message: "Temporary reviewer failure.",
          }),
          sessionUsability: "unknown" as const,
          attempts: 1,
          stdout: "",
        }),
      );
      const failed = yield* runTaskBackedCandidate(ready, passingValidationPolicy, failedCandidate);
      expect(failed).toMatchObject({ ok: false, outcome: "tooling_failed" });

      git(ready.repo, "commit", "--allow-empty", "-m", "clean acceptance candidate");
      const cleanCandidate = yield* captureLocalCandidate({
        cwd: ready.repo,
        now: "2026-07-15T10:02:00.000Z",
      });
      if (!cleanCandidate.ok) throw new Error(`Candidate capture failed: ${cleanCandidate.code}`);
      review.mockImplementation(() =>
        Effect.succeed({
          ok: true,
          report: { findings: [] },
          attempts: 1,
          stdout: "clean acceptance report",
        }),
      );
      const clean = yield* runTaskBackedCandidate(ready, passingValidationPolicy, cleanCandidate);
      expect(clean).toMatchObject({ ok: true, outcome: "passed" });
      expect(review.mock.calls[2]?.[0].prompt).toContain(earlierFinding.title);

      git(ready.repo, "commit", "--allow-empty", "-m", "successor acceptance candidate");
      const successor = yield* captureLocalCandidate({ cwd: ready.repo, now: successorNow });
      if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

      const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

      expect(final).toMatchObject({ ok: true, outcome: "passed" });
      expect(review).toHaveBeenCalledTimes(4);
      expect(review.mock.calls[3]?.[0].prompt).not.toContain(earlierFinding.title);
    }),
  );
});

type AcceptanceReadyRepo = {
  readonly repo: string;
  readonly captured: Captured;
  readonly validation: ReturnType<typeof candidateValidationForTest>;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime<ReviewerOutput>;
  readonly sessionStore?: ReviewerSessionStore;
  readonly reviewerSessionsRoot?: string;
};

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
      const started = yield* persistence.execution.startOrReuse({
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

      yield* persistence.execution.recordCheckRound({
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
      const commandExecutor = () =>
        Effect.succeed({
          exitCode: 0,
          stdout: `${captured.headSha}\n`,
          stderr: "",
        });
      const acceptance = yield* runAcceptanceReviewPhase({
        validationRunId: started.validationRunId,
        changeId: captured.changeId,
        candidate: {
          candidateId: captured.candidateId,
          changeBaseSha: captured.changeBaseSha,
          headSha: captured.headSha,
        },
        acceptanceContext,
        implementationDecisions: [],
        policy: policy.acceptanceReview,
        ...(policy.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: policy.agentEnvironment }),
        runtime: ready.reviewerAgentRuntime,
        ...(ready.sessionStore === undefined ? {} : { sessionStore: ready.sessionStore }),
        ...(ready.reviewerSessionsRoot === undefined
          ? {}
          : { sessionStorageRoot: ready.reviewerSessionsRoot }),
        commandExecutor,
        reviewerExecutor: unusedReviewerExecutor,
        artifactsRoot: join(commonDirectory(ready.repo), "but-why", "artifacts"),
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: ready.repo,
        resourceRoot: ready.repo,
        allowedUntrackedFiles: [],
        now,
        listArtifacts: persistence.reads.listArtifacts,
        listPreviousCandidateReviewerFindings:
          persistence.execution.listPreviousCandidateReviewerFindings,
        recordAcceptanceRound: persistence.execution.recordAcceptanceRound,
      });
      if (acceptance.toolingFailure !== undefined) {
        yield* persistence.execution.recordToolingFailure({
          validationRunId: started.validationRunId,
          ...validationToolingFailureRecord(acceptance.toolingFailure),
          now,
        });
        yield* persistence.execution.complete({
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
        yield* persistence.execution.complete({
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
      yield* persistence.execution.complete({
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
    }),
  );

const acceptanceReadyRepo = (
  reviewerAgentRuntime: ReviewerAgentRuntime<ReviewerOutput>,
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
