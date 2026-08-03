import type { Sandbox } from "@ai-hero/sandcastle";
import { chmodSync, readdirSync, statSync } from "node:fs";
import { Clock, Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { AcceptanceReviewPolicy } from "./acceptanceReviewConfig.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import {
  buildAcceptanceReviewerPrompt,
  reviewerFindingHistory,
} from "../../agent/reviewerPrompts.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import { validationPhase } from "../validationRun/validationRun.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import type { RecordCandidateAcceptanceRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import {
  runWithSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
} from "../validation/submitProgress.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import {
  continuationPrompt,
  reviewerSessionFingerprint,
  reviewerSessionsPath,
  sessionIdentityMatches,
  type ReviewerSessionStore,
  type ReviewerContinuity,
} from "../reviewerSession/reviewerSession.js";

export type RunAcceptanceReviewPhaseInput = {
  readonly validationRunId: string;
  readonly changeId: string;
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly implementationDecisions: readonly ImplementationDecision[] | undefined;
  readonly blockerHistory?: ImplementationBlockerHistory;
  readonly policy: AcceptanceReviewPolicy;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly runtime: ReviewerAgentRuntime;
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly artifactsRoot: string;
  readonly artifactMaxBytes?: number;
  readonly commandCwd: string;
  readonly resourceRoot?: string;
  readonly sessionStorageRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
  readonly allowedUntrackedFiles: readonly string[];
  readonly progress?: SubmitProgress;
  readonly now: string;
  readonly listArtifacts: (
    validationRunId: string,
  ) => Effect.Effect<readonly { readonly ref: string }[], RepositoryStorageError>;
  readonly listPreviousCandidateReviewerFindings: (input: {
    readonly candidateId: string;
    readonly phase: "acceptance_review";
    readonly producer: "acceptance";
  }) => Effect.Effect<
    readonly {
      readonly title: string;
      readonly description: string;
      readonly evidence: string;
      readonly files: readonly string[];
      readonly artifactRefs: readonly string[];
    }[],
    RepositoryStorageError
  >;
  readonly recordAcceptanceRound: (
    input: RecordCandidateAcceptanceRoundInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};
export type ReviewerContinuityEvidence = {
  readonly continuity: ReviewerContinuity;
  readonly identityFingerprint: string;
  readonly durationMs: number;
  readonly reviewCalls: number;
  readonly restartReason?: string;
};

export type RunAcceptanceReviewPhaseResult = {
  readonly findings: 0 | 1;
  readonly reviewerEvidence?: ReviewerContinuityEvidence;
  readonly toolingFailure?: ValidationToolingFailure;
};

export const runAcceptanceReviewPhase = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<
  RunAcceptanceReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError
> =>
  runWithSubmitProgress({
    progress: input.progress,
    phase: { kind: "acceptance", profile: progressProfile(input.policy.profile) },
    run: runAcceptanceReviewPhaseImpl(input),
    outcome: (result) =>
      result.toolingFailure === undefined && result.findings === 0 ? "passed" : "failed",
    details: (result) => ({
      ...(result.toolingFailure !== undefined
        ? { reason: "tooling" as const }
        : result.findings === 1
          ? { reason: "findings" as const }
          : {}),
      ...(result.reviewerEvidence === undefined
        ? {}
        : {
            continuity: result.reviewerEvidence.continuity,
            reviewCalls: result.reviewerEvidence.reviewCalls,
          }),
    }),
  });

const runAcceptanceReviewPhaseImpl = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<
  RunAcceptanceReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    yield* verifyIntegrity(input);
    const startedAt = yield* Clock.currentTimeMillis;
    const availableArtifactRefs = (yield* input.listArtifacts(input.validationRunId)).map(
      (artifact) => artifact.ref,
    );
    const earlierFindings = reviewerFindingHistory(
      yield* input.listPreviousCandidateReviewerFindings({
        candidateId: input.candidate.candidateId,
        phase: validationPhase.acceptanceReview,
        producer: "acceptance",
      }),
    );
    const prompt = buildAcceptanceReviewerPrompt({
      instructions: input.policy.instructions,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      previousFindings: earlierFindings,
      candidate: input.candidate,
      acceptanceContext: input.acceptanceContext,
      implementationDecisions: input.implementationDecisions ?? [],
      ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
    });
    const identity = {
      changeId: input.changeId,
      producer: "acceptance" as const,
      agentProfile: input.policy.profile,
      instructions: input.policy.instructions,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      resources: {
        ...(input.policy.profile.profile.runtimeConfig?.extensions === undefined
          ? {}
          : { extensions: input.policy.profile.profile.runtimeConfig.extensions }),
        ...(input.policy.profile.profile.runtimeConfig?.skills === undefined
          ? {}
          : { skills: input.policy.profile.profile.runtimeConfig.skills }),
        ...(input.policy.profile.profile.runtimeConfig?.tools === undefined
          ? {}
          : { tools: input.policy.profile.profile.runtimeConfig.tools }),
      },
    };
    const fingerprint = reviewerSessionFingerprint(identity);
    const stored =
      input.sessionStore === undefined
        ? undefined
        : yield* input.sessionStore.get(identity.changeId, identity.producer);
    const identityCompatible = stored !== undefined && sessionIdentityMatches(stored, identity);
    const compatible =
      identityCompatible &&
      typeof stored.sessionReference === "string" &&
      stored.sessionReference.length > 0;
    let continuity: ReviewerContinuity = compatible
      ? "resumed"
      : stored === undefined
        ? "fresh"
        : "restarted";
    let restartReason: string | undefined =
      stored === undefined
        ? undefined
        : identityCompatible &&
            typeof stored.sessionReference === "string" &&
            stored.sessionReference.length === 0
          ? "session_capture_unavailable"
          : compatible
            ? undefined
            : "identity_mismatch";
    if (stored !== undefined && !identityCompatible && input.sessionStore !== undefined) {
      yield* input.sessionStore.remove(identity.changeId, identity.producer);
    }
    let reviewCalls = 0;
    const review = (resumeSession?: string) => {
      reviewCalls += 1;
      return input.runtime.review({
        sandbox: input.sandbox,
        reviewer: "acceptance",
        validationRunId: input.validationRunId,
        availableArtifactRefs,
        prompt:
          compatible && resumeSession !== undefined
            ? continuationPrompt({
                candidate: input.candidate,
                acceptanceContext: input.acceptanceContext,
                implementationDecisions: input.implementationDecisions ?? [],
                ...(input.blockerHistory === undefined
                  ? {}
                  : { blockerHistory: input.blockerHistory }),
                availableArtifactRefs,
                previousFindings: earlierFindings,
              })
            : prompt,
        profile: input.policy.profile,
        commandCwd: input.commandCwd,
        ...(input.resourceRoot === undefined ? {} : { resourceRoot: input.resourceRoot }),
        ...(input.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: input.agentEnvironment }),
        ...(input.sessionStorageRoot === undefined
          ? {}
          : {
              sessionStorageRoot: reviewerSessionsPath(
                `${input.sessionStorageRoot}/${identity.changeId}`,
              ),
            }),
        ...(resumeSession === undefined ? {} : { resumeSession }),
      });
    };
    let provisional = yield* review(compatible ? stored?.sessionReference : undefined);
    if (!provisional.ok && compatible) {
      const sessionFailure = isUnusableReviewerSessionFailure(provisional.failure);
      if (sessionFailure) {
        continuity = "restarted";
        restartReason = "session_unusable";
        if (input.sessionStore !== undefined)
          yield* input.sessionStore.remove(identity.changeId, identity.producer);
        provisional = yield* review();
      }
    }
    yield* verifyIntegrity(input);
    const result = provisional;
    if (result.ok && result.sessionReference === undefined && restartReason === undefined) {
      restartReason = "session_capture_unavailable";
    }
    const sessionPermissionsOk =
      result.sessionFilePath === undefined || chmodSessionFile(result.sessionFilePath);
    if (!sessionPermissionsOk && restartReason === undefined) {
      restartReason = "session_permissions_unavailable";
    }
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.acceptanceReview,
      producer: "acceptance",
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      executionEvidence: {
        continuity,
        identityFingerprint: fingerprint,
        ...(restartReason === undefined ? {} : { restartReason }),
        durationMs: (yield* Clock.currentTimeMillis) - startedAt,
        reviewCalls,
      },
    });
    const findings = result.ok
      ? result.report.findings.map((finding, index) => ({
          id: `${input.validationRunId}-acceptance-F${index + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.acceptanceReview,
          producer: "acceptance" as const,
          ...finding,
        }))
      : [];
    yield* input.recordAcceptanceRound({
      validationRunId: input.validationRunId,
      roundNumber: 1,
      roundStatus: result.ok && findings.length === 0 ? "passed" : "failed",
      phaseStatus: result.ok && findings.length === 0 ? "passed" : "failed",
      artifactRecords: artifacts,
      findings,
      now: input.now,
    });
    if (!result.ok) {
      return {
        findings: 0,
        reviewerEvidence: {
          continuity,
          identityFingerprint: fingerprint,
          ...(restartReason === undefined ? {} : { restartReason }),
          durationMs: (yield* Clock.currentTimeMillis) - startedAt,
          reviewCalls,
        },
        toolingFailure: result.failure,
      };
    }
    if (input.sessionStore !== undefined && sessionPermissionsOk) {
      yield* input.sessionStore.save({
        identity,
        fingerprint,
        sessionReference: result.sessionReference ?? "",
        lastCandidateId: input.candidate.candidateId,
      });
    }
    return {
      findings: findings.length === 0 ? 0 : 1,
      reviewerEvidence: {
        continuity,
        identityFingerprint: fingerprint,
        ...(restartReason === undefined ? {} : { restartReason }),
        durationMs: (yield* Clock.currentTimeMillis) - startedAt,
        reviewCalls,
      },
    };
  });

const progressProfile = (
  profile: RunAcceptanceReviewPhaseInput["policy"]["profile"],
): SubmitProgressProfile => ({
  name: profile.agentProfile,
  model: profile.profile.runtimeConfig?.model ?? "unknown",
  thinking: profile.profile.runtimeConfig?.thinking ?? "default",
});

const isUnusableReviewerSessionFailure = (failure: ValidationToolingFailure): boolean =>
  failure._tag === "SandcastleToolingFailed" &&
  (/^resumeSession ".+" not found(?: under|: expected)/m.test(failure.message) ||
    /^Session resume failed:/m.test(failure.message) ||
    /^Reviewer Session (?:JSONL is corrupt|header is (?:incompatible|missing))\.$/m.test(
      failure.message,
    ) ||
    /No session found matching/m.test(failure.message));

const chmodSessionFile = (path: string): boolean => {
  try {
    chmodSync(path, 0o700);
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (!chmodSessionFile(`${path}/${entry}`)) return false;
      }
    } else {
      chmodSync(path, 0o600);
    }
    return true;
  } catch {
    return false;
  }
};

const verifyIntegrity = (
  input: RunAcceptanceReviewPhaseInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  verifyCandidateIntegrity({
    sandbox: input.sandbox,
    commandCwd: input.commandCwd,
    expectedHeadSha: input.candidate.headSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
    operationName: "verify_acceptance_candidate",
  });
