import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { afterAll, beforeAll, vi } from "vitest";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../src/agent/reviewerExecution.js";
import type { ReviewerOutput } from "../../src/agent/reviewerOutput.js";
import { runAcceptanceReviewPhase } from "../../src/change/acceptanceReview/runAcceptanceReviewPhase.js";
import type { CaptureLocalCandidateResult } from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type { CandidateValidationPolicySnapshot } from "../../src/change/candidateValidation/candidateValidationPolicySnapshot.js";
import type { AcceptanceContextCandidateValidationPolicy } from "../../src/change/candidateValidation/validateCandidate.js";
import type { AcceptanceContextSnapshotV1 } from "../../src/change/validationRun/acceptanceContextSnapshot.js";
import { maxValidationArtifactBytes } from "../../src/change/validationRun/artifactFiles.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  candidateReadyRepo,
  candidateRepositoryConfig,
  commonDirectory,
  git,
} from "../support/candidateReadyRepo.js";
import { candidateValidationForTest } from "../support/candidateValidation.js";
import { cloneInitializedTestRepository } from "../support/initializedRepo.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const unusedReviewerExecutor: ReviewerProcessExecutor = {
  execute: () => Effect.die("Reviewer test runtime must not execute a reviewer process."),
};

type Captured = Extract<CaptureLocalCandidateResult, { readonly ok: true }>;
let candidateRepoTemplate: string;

beforeAll(() => {
  candidateRepoTemplate = acquireTestWorkspace();
  candidateReadyRepo(candidateRepoTemplate);
  const database = new DatabaseSync(join(candidateRepoTemplate, ".git", "but-why", "state.sqlite"));
  try {
    database
      .prepare("INSERT INTO tasks (id, title, description, state) VALUES (1, ?, ?, 'todo')")
      .run(acceptanceContext.title, acceptanceContext.description);
    database
      .prepare(
        "UPDATE changes SET initial_acceptance_context = ?, reviewer_configuration = ? WHERE id = 1",
      )
      .run(
        JSON.stringify(acceptanceContext),
        JSON.stringify({ acceptanceReview: acceptancePolicy, specialistReviews: [] }),
      );
    database.prepare("INSERT INTO task_change_links (task_id, change_id) VALUES (1, 1)").run();
  } finally {
    database.close();
  }
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
    const captured = yield* captureLocalCandidate({ cwd: candidateRepoTemplate });
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

layer(acceptanceTemplateLayer)(
  "Candidate Acceptance Review for a Change linked to a Task",
  (it) => {
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
        const findings = yield* validation.listFindings(result.validationRunId);
        expect(findings).toHaveLength(2);
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
        expect(yield* ready.validation.listPhaseResults(result.validationRunId)).toEqual([
          { producer: "quality", outcome: "passed" },
          { producer: "acceptance", outcome: "failed" },
        ]);
      }),
    );

    it.scoped("does not carry Acceptance Findings across an intermediate Candidate", () =>
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
        });
        if (!failedCandidate.ok)
          throw new Error(`Candidate capture failed: ${failedCandidate.code}`);
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
        const failed = yield* runTaskBackedCandidate(
          ready,
          passingValidationPolicy,
          failedCandidate,
        );
        expect(failed).toMatchObject({ ok: false, outcome: "tooling_failed" });

        git(ready.repo, "commit", "--allow-empty", "-m", "clean acceptance candidate");
        const cleanCandidate = yield* captureLocalCandidate({
          cwd: ready.repo,
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
        expect(review.mock.calls[2]?.[0].prompt).not.toContain(earlierFinding.title);

        git(ready.repo, "commit", "--allow-empty", "-m", "successor acceptance candidate");
        const successor = yield* captureLocalCandidate({ cwd: ready.repo });
        if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);

        const final = yield* runTaskBackedCandidate(ready, passingValidationPolicy, successor);

        expect(final).toMatchObject({ ok: true, outcome: "passed" });
        expect(review).toHaveBeenCalledTimes(4);
        expect(review.mock.calls[3]?.[0].prompt).not.toContain(earlierFinding.title);
      }),
    );
  },
);

type AcceptanceReadyRepo = {
  readonly repo: string;
  readonly captured: Captured;
  readonly validation: ReturnType<typeof candidateValidationForTest>;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime<ReviewerOutput>;
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
      });
      if (started.reused) return { ok: true as const, ...started, outcome: "passed" as const };
      if ("blocked" in started) {
        throw new Error("Unexpected active Blocker in Acceptance Review fixture");
      }
      yield* persistence.execution.recordWorkspaceCleanup({
        validationRunId: started.validationRunId,
        cleanupWorkspace: "not_created",
      });

      yield* persistence.execution.recordCheckResult({
        validationRunId: started.validationRunId,
        producer: "quality",
        outcome: "passed",
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
        commandExecutor,
        reviewerExecutor: unusedReviewerExecutor,
        artifactsRoot: join(commonDirectory(ready.repo), "but-why", "artifacts"),
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: ready.repo,
        resourceRoot: ready.repo,
        sessionStorageRoot: join(commonDirectory(ready.repo), "but-why", "artifacts"),
        agentPersistence: persistence.agentPersistence,
        getAgentSession: persistence.agentSessions.getAgentSession,
        linkAgentInvocation: persistence.agentSessions.linkAgentInvocation,
        settleAgentInvocationResult: persistence.execution.settleAgentInvocationResult,
        recordAcceptanceResult: persistence.execution.recordAcceptanceResult,
        allowedUntrackedFiles: [],
        listArtifacts: persistence.reads.listArtifacts,
        listPreviousCandidateReviewerFindings:
          persistence.execution.listPreviousCandidateReviewerFindings,
      }).pipe(Effect.provide(NodeFileSystem.layer));
      yield* persistence.execution.complete({
        validationRunId: started.validationRunId,
        outcome: acceptance.outcome,
      });
      return acceptance.outcome === "tooling_failed"
        ? {
            ok: false as const,
            validationRunId: started.validationRunId,
            outcome: acceptance.outcome,
          }
        : {
            ok: true as const,
            reused: false as const,
            validationRunId: started.validationRunId,
            outcome: acceptance.outcome,
          };
    }),
  );

const acceptanceReadyRepo = (
  reviewerAgentRuntime: ReviewerAgentRuntime<ReviewerOutput>,
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
    });
    return {
      repo,
      captured,
      validation,
      reviewerAgentRuntime,
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
