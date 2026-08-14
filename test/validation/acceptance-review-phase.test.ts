import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
import type {
  ReviewerSessionRecord,
  ReviewerSessionStore,
} from "../../src/agent/reviewerSession/reviewerSession.js";
import {
  type RunAcceptanceReviewPhaseInput,
  runAcceptanceReviewPhase as runAcceptanceReviewPhaseWithFileSystem,
} from "../../src/change/acceptanceReview/runAcceptanceReviewPhase.js";
import type { RecordCandidateAcceptanceRoundInput } from "../../src/change/candidateValidation/candidateValidationRunStore.js";
import type { ImplementationBlockerHistory } from "../../src/change/implementationBlocker.js";
import type { ImplementationDecision } from "../../src/change/implementationDecision.js";
import type { AcceptanceContextSnapshotV1 } from "../../src/change/validationRun/acceptanceContextSnapshot.js";
import { repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-07-15T10:00:00.000Z";
const candidate = {
  candidateId: "candidate-current",
  changeBaseSha: "base-sha",
  headSha: "head-sha",
};
const acceptanceContext = Object.freeze({
  version: 1 as const,
  title: "Keep the exact accepted intent",
  description: "This immutable Acceptance Context is the review authority.",
}) satisfies AcceptanceContextSnapshotV1;
const policy = {
  instructions: "Apply the repository Acceptance instructions.",
  instructionsSource: "repo" as const,
  profile: {
    agentProfile: "strict",
    scope: "repo" as const,
    profile: {
      agentRuntime: "pi" as const,
      runtimeConfig: { model: "review-model", thinking: "high" as const },
    },
  },
};
const decision: ImplementationDecision = {
  id: "decision-1",
  changeId: "change-1",
  sequence: 1,
  recordedAt: now,
  choice: "Keep the phase owner",
  rationale: "This keeps Acceptance-specific evidence local.",
};
const blockerHistory: ImplementationBlockerHistory = {
  blockers: [
    {
      id: "blocker-1",
      changeId: "change-1",
      sequence: 1,
      reportedAt: now,
      content: "Authority was ambiguous.",
      resolvedAt: now,
      resolution: {
        id: "resolution-1",
        blockerId: "blocker-1",
        recordedAt: now,
        content: "Use the captured Acceptance Context.",
      },
    },
  ],
  resolutions: [
    {
      id: "resolution-1",
      blockerId: "blocker-1",
      recordedAt: now,
      content: "Use the captured Acceptance Context.",
    },
  ],
  active: null,
};

const cleanReport: ReviewerAgentResult<ReviewerOutput> = {
  ok: true,
  report: { findings: [] },
  attempts: 1,
  stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
};

const runAcceptanceReviewPhase = (
  input: Parameters<typeof runAcceptanceReviewPhaseWithFileSystem>[0],
) => runAcceptanceReviewPhaseWithFileSystem(input).pipe(Effect.provide(NodeFileSystem.layer));

const finding = (title: string) => ({
  title,
  description: `${title} description`,
  evidence: `${title} evidence`,
  files: ["src/affected.ts"],
  artifactRefs: [],
});

describe("Acceptance Review phase", () => {
  it.scoped("judges the exact Candidate against all admitted immutable authority", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
        Effect.succeed(cleanReport),
      );
      const fixture = acceptancePhaseFixture(
        { review },
        {
          implementationDecisions: [decision],
          blockerHistory,
          previousFindings: [finding("Earlier Acceptance Finding")],
          availableArtifactRefs: ["artifact:validation-1/checks/quality/stdout.txt"],
        },
      );

      const result = yield* fixture.run();

      expect(result).toMatchObject({
        findings: 0,
        reviewerEvidence: { reviewCalls: 1, invocationUsage: [null] },
      });
      expect(review).toHaveBeenCalledOnce();
      const call = review.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        reviewer: "acceptance",
        profile: policy.profile,
        agentEnvironment: ["nix", "develop", "-c"],
      });
      expect(call?.prompt).toContain(candidate.candidateId);
      expect(call?.prompt).toContain(candidate.changeBaseSha);
      expect(call?.prompt).toContain(candidate.headSha);
      expect(call?.prompt).toContain(acceptanceContext.description);
      expect(call?.prompt).toContain(decision.choice);
      expect(call?.prompt).toContain(blockerHistory.resolutions[0]?.content);
      expect(call?.prompt).toContain("Earlier Acceptance Finding");
      expect(call?.prompt).toContain("artifact:validation-1/checks/quality/stdout.txt");
      expect(fixture.rounds).toEqual([
        expect.objectContaining({
          validationRunId: "validation-1",
          roundStatus: "passed",
          findings: [],
          artifactRecords: expect.arrayContaining([
            expect.objectContaining({ phase: "acceptance_review", producer: "acceptance" }),
          ]),
        }),
      ]);
    }),
  );

  it.scoped("runs the normal Pi reviewer process through the Acceptance Candidate boundary", () =>
    Effect.gen(function* () {
      const workspace = createTestWorkspace();
      const agentPersistence: NonNullable<RunAcceptanceReviewPhaseInput["agentPersistence"]> = {
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
      };
      const linkAgentInvocation: NonNullable<RunAcceptanceReviewPhaseInput["linkAgentInvocation"]> =
        () => () =>
          Effect.void;
      const settleAgentInvocationRound: NonNullable<
        RunAcceptanceReviewPhaseInput["settleAgentInvocationRound"]
      > = () => () => Effect.void;
      const actualPolicy = {
        ...policy,
        profile: {
          ...policy.profile,
          profile: {
            ...policy.profile.profile,
            runtimeConfig: {
              model: "but-why-test/deterministic-reviewer",
              thinking: "off" as const,
              extensions: [join(repoRoot, "test/fixtures/pi/deterministic-provider.mjs")],
            },
          },
        },
      };
      const fixture = acceptancePhaseFixture(piReviewerAgentRuntime, {
        policy: actualPolicy,
        agentEnvironment: [],
        agentPersistence,
        linkAgentInvocation,
        settleAgentInvocationRound,
        commandCwd: workspace,
        resourceRoot: workspace,
        reviewerExecutor: createPiReviewerProcessExecutor(),
      });

      const result = yield* fixture.run();

      expect(result).toMatchObject({
        findings: 0,
        reviewerEvidence: {
          agentSessionId: 1,
          invocations: [
            {
              id: 1,
              continuationId: 1,
              settlementKind: "returned",
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
              },
            },
          ],
        },
      });
      expect(result.reviewerEvidence).not.toHaveProperty("continuity");
      expect(result.reviewerEvidence).not.toHaveProperty("reviewCalls");
    }),
  );

  it.scoped("requests Validation Run abandonment when Agent Artifact persistence fails", () =>
    Effect.gen(function* () {
      const workspace = createTestWorkspace();
      const artifactsRoot = join(workspace, "artifact-root-file");
      writeFileSync(artifactsRoot, "not a directory");
      const settledInvocationIds: number[] = [];
      const agentPersistence: NonNullable<RunAcceptanceReviewPhaseInput["agentPersistence"]> = {
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
        settleInvocation: ({ invocationId }) =>
          Effect.sync(() => {
            settledInvocationIds.push(invocationId);
          }),
        readInvocationHistory: () => Effect.succeed([]),
      };
      const fixture = acceptancePhaseFixture(
        { review: () => Effect.succeed(cleanReport) },
        {
          agentPersistence,
          linkAgentInvocation: () => () => Effect.void,
          settleAgentInvocationRound: () => () => Effect.void,
          artifactsRoot,
        },
      );

      const result = yield* fixture.run();

      expect(result).toMatchObject({
        findings: 0,
        requiresAbandonment: true,
        toolingFailure: { _tag: "InfrastructureToolingFailed" },
      });
      expect(settledInvocationIds).toEqual([]);
      expect(fixture.rounds).toEqual([]);
    }),
  );

  it.scoped("rejects a different workspace Candidate before reviewer launch", () =>
    Effect.gen(function* () {
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
        Effect.succeed(cleanReport),
      );
      const fixture = acceptancePhaseFixture({ review }, { observedHeadSha: "different-head-sha" });

      const failure = yield* Effect.flip(fixture.run());

      expect(failure).toMatchObject({
        _tag: "GitToolingFailed",
        operationName: "verify_candidate_head",
      });
      expect(review).not.toHaveBeenCalled();
      expect(fixture.rounds).toEqual([]);
    }),
  );

  it.scoped("keeps every valid reported Finding in the failed Acceptance round", () =>
    Effect.gen(function* () {
      const findings = [finding("First mismatch"), finding("Second mismatch")];
      const fixture = acceptancePhaseFixture({
        review: () =>
          Effect.succeed({
            ok: true,
            report: { findings },
            attempts: 1,
            stdout: "review evidence",
          }),
      });

      const result = yield* fixture.run();

      expect(result).toMatchObject({ findings: 1 });
      expect(fixture.rounds).toHaveLength(1);
      expect(fixture.rounds[0]).toMatchObject({
        roundStatus: "failed",
        findings: [
          { id: "validation-1-acceptance-F1", title: "First mismatch" },
          { id: "validation-1-acceptance-F2", title: "Second mismatch" },
        ],
      });
      expect(fixture.rounds[0]?.artifactRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("stdout.txt") }),
          expect.objectContaining({ path: expect.stringContaining("reviewer-output.json") }),
          expect.objectContaining({ path: expect.stringContaining("execution.json") }),
        ]),
      );
    }),
  );

  it.scoped("classifies a reviewer runtime failure as tooling failure without a Finding", () =>
    Effect.gen(function* () {
      const fixture = acceptancePhaseFixture({
        review: () =>
          Effect.succeed({
            ok: false,
            failure: new ReviewerExecutionFailed({
              kind: "process_execution",
              operationName: "run_reviewer_process",
              message: "Reviewer launch failed.",
            }),
            sessionUsability: "unknown",
            attempts: 1,
            stdout: "",
          }),
      });

      const result = yield* fixture.run();

      expect(result).toMatchObject({
        findings: 0,
        toolingFailure: {
          _tag: "ReviewerProcessToolingFailed",
          operationName: "run_reviewer_process",
        },
      });
      expect(fixture.rounds).toEqual([
        expect.objectContaining({ roundStatus: "failed", findings: [] }),
      ]);
    }),
  );

  it.scoped("classifies exhausted structured output as tooling failure without a Finding", () =>
    Effect.gen(function* () {
      const fixture = acceptancePhaseFixture({
        review: () =>
          Effect.succeed({
            ok: false,
            failure: new ReviewerExecutionFailed({
              kind: "output_contract",
              operationName: "decode_reviewer_output",
              diagnostics: [],
              message: "Structured output correction failed.",
            }),
            sessionUsability: "unknown",
            attempts: 2,
            stdout: "invalid output",
          }),
      });

      const result = yield* fixture.run();

      expect(result).toMatchObject({
        findings: 0,
        toolingFailure: {
          _tag: "ReviewerOutputContractFailed",
          operationName: "decode_reviewer_output",
          attempts: 2,
        },
      });
      expect(fixture.rounds[0]).toMatchObject({ roundStatus: "failed", findings: [] });
    }),
  );

  it.scoped("turns Artifact recording failure into Validation Tooling Failure", () =>
    Effect.gen(function* () {
      const artifactsRoot = createTestWorkspace();
      writeFileSync(join(artifactsRoot, "validation-1"), "blocks the artifact directory");
      const fixture = acceptancePhaseFixture(
        { review: () => Effect.succeed(cleanReport) },
        {
          artifactsRoot,
        },
      );

      const failure = yield* Effect.flip(fixture.run());

      expect(failure).toMatchObject({
        _tag: "InfrastructureToolingFailed",
        operationName: "record_reviewer_artifacts",
      });
      expect(fixture.rounds).toEqual([]);
    }),
  );

  it.scoped(
    "resumes a compatible Acceptance Reviewer Session and preserves it on unknown failure",
    () =>
      Effect.gen(function* () {
        const sessions = new Map<string, ReviewerSessionRecord>();
        const sessionStore = memorySessionStore(sessions);
        const firstReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed({ ...cleanReport, sessionReference: "acceptance-session" }),
        );
        const first = acceptancePhaseFixture({ review: firstReview }, { sessionStore });
        const firstResult = yield* first.run();
        expect(firstResult.reviewerEvidence).toMatchObject({ continuity: "fresh", reviewCalls: 1 });
        const persistedFingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              changeId: "change-1",
              producer: "acceptance",
              agentProfile: policy.profile,
              instructions: policy.instructions,
              agentEnvironment: ["nix", "develop", "-c"],
              resources: {},
            }),
          )
          .digest("hex");
        expect(sessions.get("change-1/acceptance")?.fingerprint).toBe(persistedFingerprint);

        const temporaryFailure = new ReviewerExecutionFailed({
          kind: "process_execution",
          operationName: "run_reviewer_process",
          message: "Temporary reviewer failure.",
        });
        const resumedReview = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>(() =>
          Effect.succeed({
            ok: false,
            failure: temporaryFailure,
            sessionUsability: "unknown",
            attempts: 1,
            stdout: "",
          }),
        );
        const resumed = acceptancePhaseFixture(
          { review: resumedReview },
          {
            sessionStore,
            validationRunId: "validation-2",
            candidate: {
              ...candidate,
              candidateId: "candidate-successor",
              headSha: "head-successor",
            },
          },
        );

        const result = yield* resumed.run();

        expect(result).toMatchObject({
          findings: 0,
          toolingFailure: { _tag: "ReviewerProcessToolingFailed" },
          reviewerEvidence: { continuity: "resumed", reviewCalls: 1 },
        });
        expect(resumedReview.mock.calls[0]?.[0].resumeSession).toBe("acceptance-session");
        expect(sessions.get("change-1/acceptance")?.sessionReference).toBe("acceptance-session");
      }),
  );

  it.scoped("restarts one unusable resumed Acceptance Reviewer Session for one fresh result", () =>
    Effect.gen(function* () {
      const sessions = new Map<string, ReviewerSessionRecord>();
      const sessionStore = memorySessionStore(sessions);
      const initial = acceptancePhaseFixture(
        {
          review: () => Effect.succeed({ ...cleanReport, sessionReference: "superseded-session" }),
        },
        { sessionStore },
      );
      yield* initial.run();

      const unusable = new ReviewerExecutionFailed({
        kind: "process_execution",
        operationName: "run_reviewer_process",
        message: "Stored session cannot continue.",
      });
      const review = vi.fn<ReviewerAgentRuntime<ReviewerOutput>["review"]>((input) =>
        input.resumeSession === undefined
          ? Effect.succeed({ ...cleanReport, sessionReference: "fresh-session" })
          : Effect.succeed({
              ok: false,
              failure: unusable,
              sessionUsability: "unusable",
              attempts: 1,
              stdout: "",
            }),
      );
      const successor = acceptancePhaseFixture(
        { review },
        {
          sessionStore,
          validationRunId: "validation-2",
          candidate: {
            ...candidate,
            candidateId: "candidate-successor",
            headSha: "head-successor",
          },
        },
      );

      const result = yield* successor.run();

      expect(result).toMatchObject({
        findings: 0,
        reviewerEvidence: {
          continuity: "restarted",
          restartReason: "session_unusable",
          reviewCalls: 2,
          invocationUsage: [null, null],
        },
      });
      expect(review.mock.calls.map(([input]) => input.resumeSession)).toEqual([
        "superseded-session",
        undefined,
      ]);
      expect(sessions.get("change-1/acceptance")?.sessionReference).toBe("fresh-session");
    }),
  );
});

type FixtureOptions = {
  readonly validationRunId?: string;
  readonly candidate?: typeof candidate;
  readonly policy?: RunAcceptanceReviewPhaseInput["policy"];
  readonly agentEnvironment?: RunAcceptanceReviewPhaseInput["agentEnvironment"];
  readonly reviewerExecutor?: RunAcceptanceReviewPhaseInput["reviewerExecutor"];
  readonly agentPersistence?: RunAcceptanceReviewPhaseInput["agentPersistence"];
  readonly getAgentSession?: RunAcceptanceReviewPhaseInput["getAgentSession"];
  readonly linkAgentInvocation?: RunAcceptanceReviewPhaseInput["linkAgentInvocation"];
  readonly settleAgentInvocationRound?: RunAcceptanceReviewPhaseInput["settleAgentInvocationRound"];
  readonly commandCwd?: string;
  readonly resourceRoot?: string;
  readonly sessionStorageRoot?: string;
  readonly implementationDecisions?: readonly ImplementationDecision[];
  readonly blockerHistory?: ImplementationBlockerHistory;
  readonly previousFindings?: readonly ReturnType<typeof finding>[];
  readonly availableArtifactRefs?: readonly string[];
  readonly observedHeadSha?: string;
  readonly artifactsRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
};

const unusedReviewerExecutor: ReviewerProcessExecutor = {
  execute: () => Effect.die("Captured Reviewer Agent Runtime must not execute a reviewer process."),
};

const acceptancePhaseFixture = (
  runtime: ReviewerAgentRuntime<ReviewerOutput>,
  options: FixtureOptions = {},
) => {
  const validationRunId = options.validationRunId ?? "validation-1";
  const exactCandidate = options.candidate ?? candidate;
  const rounds: RecordCandidateAcceptanceRoundInput[] = [];
  const commandExecutor = () =>
    Effect.succeed({
      exitCode: 0,
      stdout: `${options.observedHeadSha ?? exactCandidate.headSha}\n`,
      stderr: "",
    });
  const artifactsRoot = options.artifactsRoot ?? createTestWorkspace();
  const phasePolicy = options.policy ?? policy;

  return {
    rounds,
    run: () =>
      runAcceptanceReviewPhase({
        validationRunId,
        changeId: "change-1",
        candidate: exactCandidate,
        acceptanceContext,
        implementationDecisions: options.implementationDecisions ?? [],
        ...(options.blockerHistory === undefined ? {} : { blockerHistory: options.blockerHistory }),
        policy: phasePolicy,
        agentEnvironment: options.agentEnvironment ?? ["nix", "develop", "-c"],
        runtime,
        commandExecutor,
        reviewerExecutor: options.reviewerExecutor ?? unusedReviewerExecutor,
        artifactsRoot,
        commandCwd: options.commandCwd ?? "/captured/snapshot-workspace",
        resourceRoot: options.resourceRoot ?? "/captured/snapshot-workspace",
        ...(options.sessionStorageRoot === undefined
          ? {}
          : { sessionStorageRoot: options.sessionStorageRoot }),
        ...(options.agentPersistence === undefined
          ? {}
          : { agentPersistence: options.agentPersistence }),
        ...(options.getAgentSession === undefined
          ? {}
          : { getAgentSession: options.getAgentSession }),
        ...(options.linkAgentInvocation === undefined
          ? {}
          : { linkAgentInvocation: options.linkAgentInvocation }),
        ...(options.settleAgentInvocationRound === undefined
          ? {}
          : { settleAgentInvocationRound: options.settleAgentInvocationRound }),
        ...(options.sessionStore === undefined ? {} : { sessionStore: options.sessionStore }),
        allowedUntrackedFiles: [],
        now,
        listArtifacts: () =>
          Effect.succeed((options.availableArtifactRefs ?? []).map((ref) => ({ ref }))),
        listPreviousCandidateReviewerFindings: () =>
          Effect.succeed(
            (options.previousFindings ?? []).map((previous, index) => ({
              id: `previous-${index + 1}`,
              validationRunId: "validation-previous",
              phase: "acceptance_review" as const,
              producer: "acceptance",
              ...previous,
              createdAt: now,
              updatedAt: now,
            })),
          ),
        recordAcceptanceRound: (round) =>
          Effect.sync(() => {
            rounds.push(round);
          }),
      }),
  };
};

const memorySessionStore = (
  sessions: Map<string, ReviewerSessionRecord>,
): ReviewerSessionStore => ({
  get: (changeId, producer) => Effect.succeed(sessions.get(`${changeId}/${producer}`)),
  save: (record) => Effect.sync(() => sessions.set(`${record.ownerId}/${record.producer}`, record)),
  remove: (changeId, producer) => Effect.sync(() => sessions.delete(`${changeId}/${producer}`)),
});
