import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, vi } from "vitest";
import { createPiReviewerProcessExecutor } from "../../src/agent/adapters/piReviewerProcessExecutor.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentResult,
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../src/agent/reviewerExecution.js";
import type { ReviewerOutput } from "../../src/agent/reviewerOutput.js";
import {
  type RunSpecialistReviewPhaseInput,
  runSpecialistReviewPhase as runSpecialistReviewPhaseWithFileSystem,
} from "../../src/change/specialistReview/runSpecialistReviewPhase.js";
import type { SpecialistReviewPolicy } from "../../src/change/specialistReview/specialistReviewConfig.js";
import { expectedSnapshotWorkspacePath } from "../../src/change/validation/snapshotWorkspacePath.js";
import type { AcceptanceContextSnapshotV1 } from "../../src/change/validationRun/acceptanceContextSnapshot.js";
import { restoreDisposableWorkspace } from "../../src/disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { DisposableWorkspaceRestorationFailed } from "../../src/disposableWorkspace/disposableWorkspace.js";
import { repoRoot } from "../support/by-cli.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import {
  candidateReadyRepo,
  candidateRepositoryConfig,
  commonDirectory,
  git,
} from "../support/candidateReadyRepo.js";
import { candidateValidationForTest } from "../support/candidateValidation.js";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const unusedReviewerExecutor: ReviewerProcessExecutor = {
  execute: () => Effect.die("Captured Specialist runtime must not execute a reviewer process."),
};

const candidate = {
  candidateId: 1,
  changeBaseSha: "1".repeat(40),
  headSha: "2".repeat(40),
};
const acceptanceContext = Object.freeze({
  version: 1 as const,
  title: "Keep the exact intent",
  description: "Review only the accepted Candidate scope.",
}) satisfies AcceptanceContextSnapshotV1;

const policy = (id: string): SpecialistReviewPolicy => ({
  id,
  instructions: `${id} concern instructions`,
  instructionsSource: "repo",
  profile: {
    agentProfile: `${id}-profile`,
    scope: "repo",
    profile: {
      agentRuntime: "pi",
      runtimeConfig: { model: `${id}-model` },
    },
  },
});

const finding = (title: string) => ({
  title,
  description: `${title} description`,
  evidence: `${title} evidence`,
  files: [],
  artifactRefs: [],
});

const success = (
  findings: readonly ReturnType<typeof finding>[] = [],
  sessionReference?: string,
): ReviewerAgentResult<ReviewerOutput> => ({
  ok: true,
  report: { findings },
  attempts: 1,
  stdout: "specialist output",
  ...(sessionReference === undefined ? {} : { sessionReference }),
});

const outputFailure = (_reviewer: string, message: string) =>
  new ReviewerExecutionFailed({
    kind: "output_contract",
    operationName: "decode_reviewer_output",
    diagnostics: [],
    message,
  });

const defaultAgentPersistence = (): NonNullable<
  RunSpecialistReviewPhaseInput["agentPersistence"]
> => ({
  beginInvocation: ({ agentSessionId, configuration, createdAt }) => {
    const sessionId = agentSessionId ?? 1;
    const continuation = {
      id: 1,
      agentSessionId: sessionId,
      harness: "pi" as const,
      provider: configuration.provider ?? null,
      model: configuration.model,
      thinking: configuration.thinking ?? null,
      transcriptPath: null,
      unusableReason: null,
    };
    return Effect.succeed({
      ok: true as const,
      dispatch: {
        agentSessionId: sessionId,
        continuation,
        invocation: {
          id: 1,
          continuationId: continuation.id,
          createdAt,
          settledAt: null,
          settlementKind: null,
          usage: null,
          continuation,
        },
        resumed: false,
        piSessionId: "by-agent-1",
      },
    });
  },
  settleInvocation: () => Effect.void,
  readInvocationHistory: () => Effect.succeed([]),
});

const runSpecialistReviewPhase = (input: RunSpecialistReviewPhaseInput) =>
  runSpecialistReviewPhaseWithFileSystem(input).pipe(Effect.provide(NodeFileSystem.layer));

type PhaseHarness = {
  readonly results: Parameters<
    NonNullable<RunSpecialistReviewPhaseInput["settleAgentInvocationResult"]>
  >[0][];
  readonly run: (
    runtime: ReviewerAgentRuntime<ReviewerOutput>,
    overrides?: Partial<RunSpecialistReviewPhaseInput>,
    includeAcceptanceContext?: boolean,
  ) => ReturnType<typeof runSpecialistReviewPhase>;
};

const phaseHarness = (): PhaseHarness => {
  const artifactsRoot = createTestWorkspace();
  const results: Parameters<
    NonNullable<RunSpecialistReviewPhaseInput["settleAgentInvocationResult"]>
  >[0][] = [];
  const commandExecutor = (command: string, options?: { readonly cwd?: string }) => {
    const cwd = options?.cwd ?? artifactsRoot;
    if (command === "git worktree list --porcelain") {
      return Effect.succeed({
        exitCode: 0,
        stdout: `worktree ${cwd}\nHEAD ${candidate.headSha}\ndetached\n`,
        stderr: "",
      });
    }
    if (command === "git rev-parse --show-toplevel") {
      return Effect.succeed({ exitCode: 0, stdout: `${cwd}\n`, stderr: "" });
    }
    if (command === "git symbolic-ref --quiet HEAD") {
      return Effect.succeed({ exitCode: 1, stdout: "", stderr: "" });
    }
    if (command.startsWith("git reset --hard") || command === "git clean -fd -- .") {
      return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
    }
    return Effect.succeed({
      exitCode: 0,
      stdout: `${candidate.headSha}\n`,
      stderr: "",
    });
  };

  return {
    results,
    run: (runtime, overrides = {}, includeAcceptanceContext = true) =>
      runSpecialistReviewPhase({
        validationRunId: 426614174000,
        changeId: "change-1",
        candidate,
        policies: [policy("standards")],
        ...(includeAcceptanceContext ? { acceptanceContext } : {}),
        agentEnvironment: ["nix", "develop", "-c"],
        runtime,
        commandExecutor,
        reviewerExecutor: unusedReviewerExecutor,
        artifactsRoot,
        commandCwd: artifactsRoot,
        resourceRoot: artifactsRoot,
        workspaceIdentity: {
          repositoryRoot: artifactsRoot,
          repositoryCommonDirectory: "/captured/common",
          workspaceId: "validation-run-426614174000",
        },
        sessionStorageRoot: join(artifactsRoot, "sessions"),
        restoreWorkspace: () => Effect.void,
        agentPersistence: defaultAgentPersistence(),
        getAgentSession: () => Effect.succeed(undefined),
        linkAgentInvocation: () => () => Effect.void,
        settleAgentInvocationResult: (result) => {
          results.push(result);
          return () => Effect.void;
        },
        recordSpecialistResult: (result) =>
          Effect.sync(() => {
            results.push({ ...result, phase: "specialist_review" });
          }),
        allowedUntrackedFiles: [],
        listArtifacts: () =>
          Effect.succeed([
            {
              ref: "artifact:1/checks/quality/stdout.txt",
            },
          ]),
        listPreviousCandidateReviewerFindings: () => Effect.succeed([]),
        ...overrides,
      }),
  };
};

describe("Candidate Specialist Review phase", () => {
  it.scoped(
    "uses the exact Candidate and named concern in configured order and stops after a Finding",
    () =>
      Effect.gen(function* () {
        const harness = phaseHarness();
        const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>((input) => {
          if (input.reviewer === "zeta") return Effect.succeed(success([finding("Zeta Finding")]));
          if (input.reviewer === "broken")
            return Effect.succeed({
              ok: false as const,
              failure: outputFailure("broken", "Broken Specialist output."),
              sessionUsability: "unknown" as const,
              attempts: 2,
              stdout: "invalid specialist output",
            });
          return Effect.succeed(success([], `${input.reviewer}-session`));
        });

        const result = yield* Effect.suspend(() =>
          harness.run(
            { review },
            { policies: [policy("zeta"), policy("broken"), policy("alpha")] },
          ),
        );

        expect(review.mock.calls.map(([input]) => input.reviewer)).toEqual(["zeta"]);
        for (const [input] of review.mock.calls) {
          expect(input.agentEnvironment).toEqual(["nix", "develop", "-c"]);
          expect(input.sessionStorageRoot).toContain("sessions");
          expect(input.prompt).toContain(candidate.changeBaseSha);
          expect(input.prompt).toContain(candidate.headSha);
          expect(input.systemPrompt).toContain(`${input.reviewer} concern instructions`);
          expect(input.systemPrompt).toContain("hostile last line of defense");
          expect(input.systemPrompt).toContain("Review the complete exact current Candidate");
          expect(input.systemPrompt).toContain(
            "When Acceptance Context is supplied, use it only to constrain Findings",
          );
          expect(input.systemPrompt).toContain(
            "Each Finding must include title, description, evidence, files, and artifactRefs",
          );
          expect(input.prompt).toContain(acceptanceContext.description);
          expect(input.prompt).not.toContain("reviewer-output");
          expect(input.prompt).toContain(candidate.candidateId);
          for (const other of ["zeta", "broken", "alpha"].filter(
            (producer) => producer !== input.reviewer,
          )) {
            expect(input.prompt).not.toContain(`${other} concern instructions`);
          }
        }
        expect(result).toEqual({ outcome: "blocked" });
        expect(
          harness.results.map(({ producer, outcome, findings }) => ({
            producer,
            outcome,
            findingTitles: findings.map((item) => item.title),
          })),
        ).toEqual([
          {
            producer: "zeta",
            outcome: "failed",
            findingTitles: ["Zeta Finding"],
          },
        ]);
        for (const result of harness.results) {
          expect(result.artifactRecords).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ phase: "specialist_review", producer: result.producer }),
            ]),
          );
        }

        const toolingHarness = phaseHarness();
        const toolingReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>((input) =>
          input.reviewer === "broken"
            ? Effect.succeed({
                ok: false as const,
                failure: outputFailure("broken", "Broken Specialist output."),
                sessionUsability: "unknown" as const,
                attempts: 2,
                stdout: "invalid specialist output",
              })
            : Effect.succeed(success([], `${input.reviewer}-session`)),
        );
        const toolingResult = yield* Effect.suspend(() =>
          toolingHarness.run(
            { review: toolingReview },
            { policies: [policy("broken"), policy("alpha")] },
          ),
        );
        expect(toolingResult).toEqual({ outcome: "tooling_failed" });
        expect(toolingReview.mock.calls.map(([input]) => input.reviewer)).toEqual(["broken"]);
        expect(toolingHarness.results).toMatchObject([
          {
            producer: "broken",
            outcome: "failed",
            toolingFailure: { errorKind: "reviewer_output_contract_failed" },
          },
        ]);

        const changeWithoutTaskReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed(success()),
        );
        yield* harness.run({ review: changeWithoutTaskReview }, {}, false);
        expect(changeWithoutTaskReview.mock.calls[0]?.[0].prompt).not.toContain(
          acceptanceContext.description,
        );
      }),
  );

  it.scoped("runs the normal Pi reviewer process through the Specialist Candidate boundary", () =>
    Effect.gen(function* () {
      const workspace = createTestWorkspace();
      const configuredPolicy = {
        ...policy("standards"),
        profile: {
          ...policy("standards").profile,
          profile: {
            ...policy("standards").profile.profile,
            runtimeConfig: {
              model: "but-why-test/deterministic-reviewer",
              thinking: "off" as const,
              extensions: [join(repoRoot, "test/fixtures/pi/deterministic-provider.mjs")],
            },
          },
        },
      };
      const harness = phaseHarness();

      const result = yield* harness.run(piReviewerAgentRuntime, {
        policies: [configuredPolicy],
        agentEnvironment: ["env"],
        commandCwd: workspace,
        resourceRoot: workspace,
        reviewerExecutor: createPiReviewerProcessExecutor(),
      });

      expect(result).toEqual({ outcome: "passed" });
    }),
  );

  it.scoped("includes prior Findings in a fresh Specialist Agent continuation", () =>
    Effect.gen(function* () {
      const earlier = finding("Earlier Specialist Finding");
      const harness = phaseHarness();
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
        Effect.succeed(success()),
      );

      const result = yield* harness.run(
        { review },
        {
          getAgentSession: () => Effect.succeed(99),
          listPreviousCandidateReviewerFindings: () => Effect.succeed([earlier]),
        },
      );

      expect(result).toEqual({ outcome: "passed" });
      expect(review).toHaveBeenCalledOnce();
      expect(review.mock.calls[0]?.[0].prompt).toContain(earlier.title);
      expect(review.mock.calls[0]?.[0].resumeSession).toBeUndefined();
      expect(harness.results[0]?.outcome).toBe("passed");
    }),
  );

  it.scoped(
    "persists the first Specialist result and skips later Specialists across successors",
    () =>
      Effect.gen(function* () {
        const repo = candidateReadyRepo();
        const first = yield* Effect.suspend(() => captureLocalCandidate({ cwd: repo }));
        if (!first.ok) throw new Error(`Candidate capture failed: ${first.code}`);
        const artifactsRoot = join(commonDirectory(repo), "but-why", "artifacts");
        const validation = candidateValidationForTest({
          localRepositoryRoot: repo,
          artifactsRoot,
          repository: {
            statePath: candidateRepositoryConfig(repo).statePath,
            commonDirectory: commonDirectory(repo),
          },
        });
        const firstReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>((input) =>
          input.reviewer === "standards"
            ? Effect.succeed(success([finding("Durable Specialist Finding")]))
            : Effect.succeed({
                ok: false as const,
                failure: outputFailure(
                  input.reviewer,
                  `Broken durable ${input.reviewer} Specialist output.`,
                ),
                sessionUsability: "unknown" as const,
                attempts: 2,
                stdout: "invalid durable output",
              }),
        );

        const runPersisted = (
          captured: typeof first,
          policies: readonly SpecialistReviewPolicy[],
          runtime: ReviewerAgentRuntime<ReviewerOutput>,
          outcome: "passed" | "blocked" | "tooling_failed",
        ) =>
          Effect.sync(() => {
            const database = new DatabaseSync(candidateRepositoryConfig(repo).statePath);
            try {
              database.prepare("UPDATE changes SET reviewer_configuration = ? WHERE id = 1").run(
                JSON.stringify({
                  acceptanceReview: null,
                  specialistReviews: policies,
                }),
              );
            } finally {
              database.close();
            }
          }).pipe(
            Effect.zipRight(
              validation.runWithPersistence((persistence) =>
                Effect.gen(function* () {
                  const started = yield* persistence.execution.startOrReuse({
                    candidateId: captured.candidateId,
                    headSha: captured.headSha,
                    changeBaseSha: captured.changeBaseSha,
                  });
                  if (started.reused || "blocked" in started)
                    throw new Error("Expected a new unblocked Specialist Validation Run");
                  yield* persistence.execution.recordCheckResult({
                    validationRunId: started.validationRunId,
                    producer: "quality",
                    outcome: "passed",
                    artifactRecords: [],
                  });
                  const result = yield* runSpecialistReviewPhase({
                    validationRunId: started.validationRunId,
                    changeId: captured.changeId,
                    candidate: captured,
                    policies,
                    runtime,
                    commandExecutor: (command: string, options?: { readonly cwd?: string }) => {
                      const cwd = options?.cwd ?? repo;
                      if (command === "git worktree list --porcelain") {
                        return Effect.succeed({
                          exitCode: 0,
                          stdout: `worktree ${cwd}\nHEAD ${captured.headSha}\ndetached\n`,
                          stderr: "",
                        });
                      }
                      if (command === "git rev-parse --show-toplevel") {
                        return Effect.succeed({ exitCode: 0, stdout: `${cwd}\n`, stderr: "" });
                      }
                      if (command === "git symbolic-ref --quiet HEAD") {
                        return Effect.succeed({ exitCode: 1, stdout: "", stderr: "" });
                      }
                      if (
                        command.startsWith("git reset --hard") ||
                        command.startsWith("git clean -f")
                      ) {
                        return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
                      }
                      return Effect.succeed({
                        exitCode: 0,
                        stdout: `${captured.headSha}\n`,
                        stderr: "",
                      });
                    },
                    reviewerExecutor: unusedReviewerExecutor,
                    artifactsRoot,
                    commandCwd: repo,
                    resourceRoot: repo,
                    workspaceIdentity: {
                      repositoryRoot: repo,
                      repositoryCommonDirectory: commonDirectory(repo),
                      workspaceId: `validation-run-${started.validationRunId}`,
                    },
                    sessionStorageRoot: artifactsRoot,
                    restoreWorkspace: () => Effect.void,
                    agentPersistence: persistence.agentPersistence,
                    getAgentSession: persistence.agentSessions.getAgentSession,
                    linkAgentInvocation: persistence.agentSessions.linkAgentInvocation,
                    settleAgentInvocationResult: persistence.execution.settleAgentInvocationResult,
                    recordSpecialistResult: persistence.execution.recordSpecialistResult,
                    allowedUntrackedFiles: [],
                    listArtifacts: persistence.reads.listArtifacts,
                    listPreviousCandidateReviewerFindings:
                      persistence.execution.listPreviousCandidateReviewerFindings,
                  });
                  yield* persistence.execution.recordWorkspaceCleanup({
                    validationRunId: started.validationRunId,
                    cleanupWorkspace: "not_created",
                  });
                  expect(result.outcome).toBe(outcome);
                  yield* persistence.execution.complete({
                    validationRunId: started.validationRunId,
                    outcome: result.outcome,
                  });
                  return { validationRunId: started.validationRunId, result };
                }),
              ),
            ),
          );

        const frozenPolicies = [
          policy("standards"),
          policy("broken-first"),
          policy("broken-second"),
        ];
        const durable = yield* Effect.suspend(() =>
          runPersisted(first, frozenPolicies, { review: firstReview }, "blocked"),
        );
        expect(
          yield* Effect.suspend(() => validation.listPhaseResults(durable.validationRunId)),
        ).toEqual([
          { producer: "quality", outcome: "passed" },
          { producer: "standards", outcome: "failed" },
        ]);
        expect(
          (yield* Effect.suspend(() => validation.listFindings(durable.validationRunId))).map(
            (item) => item.title,
          ),
        ).toEqual(["Durable Specialist Finding"]);
        expect(
          yield* Effect.suspend(() => validation.listToolingFailures(durable.validationRunId)),
        ).toEqual([]);
        expect(
          yield* Effect.suspend(() => validation.listArtifacts(durable.validationRunId)),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: "specialist_review", producer: "standards" }),
          ]),
        );

        git(repo, "commit", "--allow-empty", "-m", "failed Specialist successor");
        const failedSuccessor = yield* Effect.suspend(() => captureLocalCandidate({ cwd: repo }));
        if (!failedSuccessor.ok)
          throw new Error(`Candidate capture failed: ${failedSuccessor.code}`);
        const failedReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed({
            ok: false as const,
            failure: outputFailure("standards", "Intermediate Specialist output failed."),
            sessionUsability: "unknown" as const,
            attempts: 2,
            stdout: "invalid intermediate output",
          }),
        );
        const failed = yield* Effect.suspend(() =>
          runPersisted(failedSuccessor, frozenPolicies, { review: failedReview }, "tooling_failed"),
        );
        expect(failedReview).toHaveBeenCalledOnce();
        expect(
          yield* Effect.suspend(() => validation.listPhaseResults(failed.validationRunId)),
        ).toEqual([
          { producer: "quality", outcome: "passed" },
          { producer: "standards", outcome: "failed" },
        ]);
        expect(
          yield* Effect.suspend(() => validation.listToolingFailures(failed.validationRunId)),
        ).toEqual([
          expect.objectContaining({
            errorKind: "reviewer_output_contract_failed",
            errorMessage: expect.stringContaining("Intermediate Specialist output failed."),
          }),
        ]);

        git(repo, "commit", "--allow-empty", "-m", "clean Specialist successor");
        const successor = yield* Effect.suspend(() => captureLocalCandidate({ cwd: repo }));
        if (!successor.ok) throw new Error(`Candidate capture failed: ${successor.code}`);
        const successorReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed(success()),
        );
        const clean = yield* Effect.suspend(() =>
          runPersisted(successor, frozenPolicies, { review: successorReview }, "passed"),
        );
        expect(successorReview).toHaveBeenCalledTimes(3);
        expect(successorReview.mock.calls[0]?.[0].prompt).not.toContain(
          "Durable Specialist Finding",
        );
        expect(yield* Effect.suspend(() => validation.listFindings(clean.validationRunId))).toEqual(
          [],
        );
        expect(
          (yield* Effect.suspend(() => validation.listFindings(durable.validationRunId))).map(
            (item) => item.title,
          ),
        ).toEqual(["Durable Specialist Finding"]);

        git(repo, "commit", "--allow-empty", "-m", "later Specialist successor");
        const laterSuccessor = yield* Effect.suspend(() => captureLocalCandidate({ cwd: repo }));
        if (!laterSuccessor.ok) throw new Error(`Candidate capture failed: ${laterSuccessor.code}`);
        const laterReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed(success()),
        );
        yield* Effect.suspend(() =>
          runPersisted(laterSuccessor, frozenPolicies, { review: laterReview }, "passed"),
        );
        expect(laterReview).toHaveBeenCalledTimes(3);
        expect(laterReview.mock.calls[0]?.[0].prompt).not.toContain("Durable Specialist Finding");
      }),
    15_000,
  );

  it.scoped("cannot pass after producer runtime or Artifact-recording failure", () =>
    Effect.gen(function* () {
      const runtimeHarness = phaseHarness();
      const launchFailure = new ReviewerExecutionFailed({
        kind: "process_execution",
        operationName: "run_reviewer_process",
        message: "Reviewer launch failed.",
      });
      const runtimeResult = yield* Effect.suspend(() =>
        runtimeHarness.run({
          review: () =>
            Effect.succeed({
              ok: false as const,
              failure: launchFailure,
              sessionUsability: "unknown" as const,
              attempts: 1,
              stdout: "",
            }),
        }),
      );
      expect(runtimeResult).toEqual({ outcome: "tooling_failed" });
      expect(runtimeHarness.results[0]?.outcome).toBe("failed");

      const artifactHarness = phaseHarness();
      const nonDirectory = join(createTestWorkspace(), "not-a-directory");
      writeFileSync(nonDirectory, "blocks Artifact directory creation");
      const artifactFailure = yield* Effect.suspend(() =>
        artifactHarness.run(
          { review: () => Effect.succeed(success()) },
          { artifactsRoot: nonDirectory },
        ),
      );
      expect(artifactFailure).toEqual({ outcome: "tooling_failed" });
      expect(artifactHarness.results).toMatchObject([
        {
          outcome: "failed",
          artifactRecords: [],
          toolingFailure: { operationName: "record_reviewer_artifacts" },
        },
      ]);
    }),
  );

  it.scoped("records initial Candidate-integrity failure for its Specialist producer", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
        Effect.succeed(success()),
      );
      const harness = phaseHarness();
      const result = yield* harness.run(
        { review },
        {
          commandExecutor: () =>
            Effect.succeed({ exitCode: 0, stdout: "different-head-sha\n", stderr: "" }),
        },
      );

      expect(result).toEqual({ outcome: "tooling_failed" });
      expect(review).not.toHaveBeenCalled();
      expect(harness.results).toMatchObject([
        {
          phase: "specialist_review",
          producer: "standards",
          outcome: "failed",
          findings: [],
          artifactRecords: [],
          toolingFailure: { operationName: "verify_candidate_head" },
        },
      ]);
    }),
  );

  it.scoped("stops retrying when workspace restoration fails", () =>
    Effect.gen(function* () {
      const harness = phaseHarness();
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
        Effect.succeed({
          ok: false as const,
          failure: new ReviewerExecutionFailed({
            kind: "output_contract",
            operationName: "decode_reviewer_output",
            message: "Structured output correction is required.",
            sessionReference: "session-1",
          }),
          sessionUsability: "unknown" as const,
          attempts: 1,
          stdout: "invalid output",
          sessionReference: "session-1",
        }),
      );
      const result = yield* harness.run(
        { review },
        {
          restoreWorkspace: () =>
            Effect.fail(
              new DisposableWorkspaceRestorationFailed({
                message: "Restoration failed.",
              }),
            ),
        },
      );

      expect(result).toEqual({ outcome: "tooling_failed" });
      expect(review).toHaveBeenCalledOnce();
      expect(harness.results).toMatchObject([
        {
          outcome: "failed",
          toolingFailure: {
            errorKind: "infrastructure_tooling_failed",
            operationName: "verify_specialist_review_candidate",
          },
        },
      ]);
    }),
  );

  it.scoped(
    "restores real Candidate mutations before retries and the next reviewer",
    () =>
      Effect.gen(function* () {
        const repo = candidateReadyRepo();
        const captured = yield* Effect.suspend(() => captureLocalCandidate({ cwd: repo }));
        if (!captured.ok) throw new Error(`Candidate capture failed: ${captured.code}`);
        const workspaceId = "validation-run-426614174001";
        const repositoryCommonDirectory = commonDirectory(repo);
        const worktreePath = expectedSnapshotWorkspacePath(repositoryCommonDirectory, 426614174001);
        mkdirSync(dirname(worktreePath), { recursive: true });
        git(repo, "worktree", "add", "--detach", "--", worktreePath, captured.headSha);
        const expectedConfig = git(worktreePath, "show", "HEAD:.but-why/config.json");
        const statuses: string[] = [];
        const results: Parameters<
          NonNullable<RunSpecialistReviewPhaseInput["settleAgentInvocationResult"]>
        >[0][] = [];
        const commandExecutor = (command: string, options?: { readonly cwd?: string }) =>
          Effect.sync(() => {
            const result = runTestProcess("bash", ["-lc", command], {
              cwd: options?.cwd ?? worktreePath,
            });
            return {
              exitCode: result.status ?? 1,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          });
        let invocations = 0;
        const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>((input) =>
          Effect.sync(() => {
            invocations += 1;
            const cwd = input.commandCwd;
            if (cwd === undefined) throw new Error("Reviewer command directory was not supplied.");
            statuses.push(git(cwd, "status", "--porcelain=v1"));
            if (input.reviewer === "standards") {
              writeFileSync(join(cwd, ".but-why/config.json"), "mutated\n");
              git(cwd, "add", ".but-why/config.json");
              writeFileSync(join(cwd, "reviewer-untracked"), "remove\n");
              if (invocations < 3) {
                return {
                  ok: false as const,
                  failure: new ReviewerExecutionFailed({
                    kind: "output_contract",
                    operationName: "decode_reviewer_output",
                    message: "Structured output correction is required.",
                    sessionReference: "session-1",
                  }),
                  sessionUsability: "unknown" as const,
                  attempts: 1,
                  stdout: "invalid output",
                  sessionReference: "session-1",
                };
              }
            }
            return success();
          }),
        );
        const result = yield* Effect.suspend(() =>
          runSpecialistReviewPhase({
            validationRunId: 426614174001,
            changeId: captured.changeId,
            candidate: captured,
            policies: [policy("standards"), policy("verification")],
            runtime: { review },
            commandExecutor,
            reviewerExecutor: unusedReviewerExecutor,
            artifactsRoot: createTestWorkspace(),
            commandCwd: worktreePath,
            resourceRoot: worktreePath,
            workspaceIdentity: {
              repositoryRoot: repo,
              repositoryCommonDirectory,
              workspaceId,
            },
            sessionStorageRoot: createTestWorkspace(),
            restoreWorkspace: restoreDisposableWorkspace,
            agentPersistence: defaultAgentPersistence(),
            getAgentSession: () => Effect.succeed(undefined),
            linkAgentInvocation: () => () => Effect.void,
            settleAgentInvocationResult: (settled) => {
              results.push(settled);
              return () => Effect.void;
            },
            recordSpecialistResult: (specialistResult) =>
              Effect.sync(() => {
                results.push({ ...specialistResult, phase: "specialist_review" });
              }),
            allowedUntrackedFiles: [],
            listArtifacts: () => Effect.succeed([]),
            listPreviousCandidateReviewerFindings: () => Effect.succeed([]),
          }),
        );

        expect(result).toEqual({ outcome: "passed" });
        expect(review).toHaveBeenCalledTimes(4);
        expect(statuses).toEqual(["", "", "", ""]);
        expect(git(worktreePath, "show", "HEAD:.but-why/config.json")).toBe(expectedConfig);
        expect(git(worktreePath, "status", "--porcelain=v1")).toBe("");
        expect(existsSync(join(worktreePath, "reviewer-untracked"))).toBe(false);
        expect(results).toHaveLength(2);
        expect(results.map(({ outcome }) => outcome)).toEqual(["passed", "passed"]);
        git(repo, "worktree", "remove", "--force", "--", worktreePath);
      }),
    15_000,
  );
});
