import type { Sandbox } from "@ai-hero/sandcastle";
import { chmodSync, readdirSync, statSync } from "node:fs";
import { Clock, Effect } from "effect";

import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { SpecialistReviewPolicy } from "./specialistReviewConfig.js";
import type {
  ReviewerAgentRuntime,
  ReviewerAgentResult,
} from "../../agent/reviewerAgentRuntime.js";
import {
  buildReviewerRevisionPrompt,
  buildSpecialistContinuationPrompt,
  buildSpecialistReviewerPrompt,
  reviewerFindingHistory,
} from "../../agent/reviewerPrompts.js";
import type { RecordCandidateSpecialistRoundInput } from "../candidateValidation/candidateValidationRunStore.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ValidationToolingFailure } from "../validation/validationToolingFailures.js";
import { verifyCandidateIntegrity } from "../validation/verifyCandidateIntegrity.js";
import { writeReviewerArtifacts } from "../validationRun/reviewerArtifacts.js";
import { validationPhase } from "../validationRun/validationRun.js";
import {
  runWithSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
} from "../validation/submitProgress.js";
import {
  reviewerSessionFingerprint,
  reviewerSessionsPath,
  sessionIdentityMatches,
  type ReviewerContinuity,
  type ReviewerSessionStore,
} from "../reviewerSession/reviewerSession.js";
import type { ReviewerContinuityEvidence } from "../acceptanceReview/runAcceptanceReviewPhase.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";

export type RunSpecialistReviewPhaseInput = {
  readonly validationRunId: string;
  readonly changeId: string;
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly policies: readonly SpecialistReviewPolicy[];
  readonly acceptanceContext?: AcceptanceContextSnapshotV1;
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
    readonly phase: "specialist_review";
    readonly producer: string;
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
  readonly recordSpecialistRound: (
    input: RecordCandidateSpecialistRoundInput,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type SpecialistReviewerContinuityEvidence = ReviewerContinuityEvidence & {
  readonly producer: string;
};

export type RunSpecialistReviewPhaseResult = {
  readonly findings: 0 | 1;
  readonly toolingFailures: readonly ValidationToolingFailure[];
  readonly reviewerEvidence: readonly SpecialistReviewerContinuityEvidence[];
};

export const runSpecialistReviewPhase = (
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<
  RunSpecialistReviewPhaseResult,
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    let hasFindings = false;
    const toolingFailures: ValidationToolingFailure[] = [];
    const reviewerEvidence: SpecialistReviewerContinuityEvidence[] = [];

    for (const [index, policy] of input.policies.entries()) {
      const result = yield* runWithSubmitProgress({
        progress: input.progress,
        phase: {
          kind: "specialist",
          id: policy.id,
          profile: progressProfile(policy.profile),
        },
        run: runSpecialist(input, policy, index + 1),
        outcome: (review) =>
          review.toolingFailure === undefined && !review.hasFindings ? "passed" : "failed",
      });
      if (result.hasFindings) hasFindings = true;
      if (result.toolingFailure !== undefined) toolingFailures.push(result.toolingFailure);
      if (result.reviewerEvidence !== undefined) reviewerEvidence.push(result.reviewerEvidence);
    }

    return {
      findings: hasFindings ? 1 : 0,
      toolingFailures,
      reviewerEvidence,
    };
  });

const runSpecialist = (
  input: RunSpecialistReviewPhaseInput,
  policy: SpecialistReviewPolicy,
  roundNumber: number,
): Effect.Effect<
  {
    readonly hasFindings: boolean;
    readonly toolingFailure?: ValidationToolingFailure;
    readonly reviewerEvidence?: SpecialistReviewerContinuityEvidence;
  },
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.gen(function* () {
    yield* verifyIntegrity(input);
    const startedAt = yield* Clock.currentTimeMillis;
    const availableArtifactRefs = (yield* input.listArtifacts(input.validationRunId)).map(
      (artifact) => artifact.ref,
    );
    const prompt = buildSpecialistReviewerPrompt({
      specialist: policy.id,
      instructions: policy.instructions,
      validationRunId: input.validationRunId,
      availableArtifactRefs,
      candidate: {
        changeBaseSha: input.candidate.changeBaseSha,
        headSha: input.candidate.headSha,
      },
      ...(input.acceptanceContext === undefined
        ? {}
        : { acceptanceContext: input.acceptanceContext }),
    });
    const earlierFindings = reviewerFindingHistory(
      yield* input.listPreviousCandidateReviewerFindings({
        candidateId: input.candidate.candidateId,
        phase: validationPhase.specialistReview,
        producer: policy.id,
      }),
    );
    const identity = {
      changeId: input.changeId,
      producer: policy.id,
      agentProfile: policy.profile,
      instructions: policy.instructions,
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
      resources: {
        ...(policy.profile.profile.runtimeConfig?.extensions === undefined
          ? {}
          : { extensions: policy.profile.profile.runtimeConfig.extensions }),
        ...(policy.profile.profile.runtimeConfig?.skills === undefined
          ? {}
          : { skills: policy.profile.profile.runtimeConfig.skills }),
        ...(policy.profile.profile.runtimeConfig?.tools === undefined
          ? {}
          : { tools: policy.profile.profile.runtimeConfig.tools }),
      },
    } as const;
    const fingerprint = reviewerSessionFingerprint(identity);
    const stored =
      input.sessionStore === undefined
        ? undefined
        : yield* input.sessionStore.get(input.changeId, policy.id);
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
      yield* input.sessionStore.remove(input.changeId, policy.id);
    }

    const review = (resumeSession?: string, reviewPrompt = prompt) =>
      input.runtime.review({
        sandbox: input.sandbox,
        reviewer: policy.id,
        validationRunId: input.validationRunId,
        availableArtifactRefs,
        prompt:
          compatible && resumeSession !== undefined && reviewPrompt === prompt
            ? buildSpecialistContinuationPrompt({
                specialist: policy.id,
                instructions: policy.instructions,
                validationRunId: input.validationRunId,
                availableArtifactRefs,
                candidate: input.candidate,
                previousFindings: earlierFindings,
                ...(input.acceptanceContext === undefined
                  ? {}
                  : { acceptanceContext: input.acceptanceContext }),
              })
            : reviewPrompt,
        profile: policy.profile,
        commandCwd: input.commandCwd,
        ...(input.resourceRoot === undefined ? {} : { resourceRoot: input.resourceRoot }),
        ...(input.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: input.agentEnvironment }),
        ...(input.sessionStorageRoot === undefined
          ? {}
          : {
              sessionStorageRoot: reviewerSessionsPath(
                `${input.sessionStorageRoot}/${input.changeId}/${policy.id}`,
              ),
            }),
        ...(resumeSession === undefined ? {} : { resumeSession }),
      });

    let provisional = yield* review(compatible ? stored?.sessionReference : undefined);
    if (!provisional.ok && compatible && isUnusableReviewerSessionFailure(provisional.failure)) {
      continuity = "restarted";
      restartReason = "session_unusable";
      if (input.sessionStore !== undefined)
        yield* input.sessionStore.remove(input.changeId, policy.id);
      provisional = yield* review();
    }
    yield* verifyIntegrity(input);

    let result: ReviewerAgentResult = provisional;
    if (provisional.ok && earlierFindings.length > 0) {
      result = yield* review(
        provisional.sessionReference,
        buildReviewerRevisionPrompt({
          reviewPrompt: prompt,
          provisionalReport: provisional.report,
          earlierFindings,
        }),
      );
      yield* verifyIntegrity(input);
    }
    if (result.ok && result.sessionReference === undefined && restartReason === undefined) {
      restartReason = "session_capture_unavailable";
    }
    const sessionPermissionsOk =
      result.sessionFilePath === undefined || chmodSessionFile(result.sessionFilePath);
    if (!sessionPermissionsOk && restartReason === undefined) {
      restartReason = "session_permissions_unavailable";
    }
    const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
    const artifacts = yield* writeReviewerArtifacts({
      validationRunId: input.validationRunId,
      phase: validationPhase.specialistReview,
      producer: policy.id,
      result,
      artifactsRoot: input.artifactsRoot,
      ...(input.artifactMaxBytes === undefined ? {} : { artifactMaxBytes: input.artifactMaxBytes }),
      executionEvidence: {
        continuity,
        identityFingerprint: fingerprint,
        ...(restartReason === undefined ? {} : { restartReason }),
        durationMs,
      },
    });
    const findings = result.ok
      ? result.report.findings.map((finding, findingIndex) => ({
          id: `${input.validationRunId}-${policy.id}-F${findingIndex + 1}`,
          validationRunId: input.validationRunId,
          phase: validationPhase.specialistReview,
          producer: policy.id,
          ...finding,
        }))
      : [];
    const passed = result.ok && findings.length === 0;

    yield* recordSpecialistRound(input, {
      validationRunId: input.validationRunId,
      producer: policy.id,
      roundNumber,
      roundStatus: passed ? "passed" : "failed",
      phaseStatus: passed ? "passed" : "failed",
      artifactRecords: artifacts,
      findings,
      now: input.now,
    });

    if (result.ok && input.sessionStore !== undefined && sessionPermissionsOk) {
      yield* input.sessionStore.save({
        identity,
        fingerprint,
        sessionReference: result.sessionReference ?? "",
        lastCandidateId: input.candidate.candidateId,
      });
    }

    return {
      hasFindings: findings.length > 0,
      ...(result.ok ? {} : { toolingFailure: result.failure }),
      reviewerEvidence: {
        producer: policy.id,
        continuity,
        identityFingerprint: fingerprint,
        ...(restartReason === undefined ? {} : { restartReason }),
        durationMs,
      },
    };
  });

const progressProfile = (profile: SpecialistReviewPolicy["profile"]): SubmitProgressProfile => ({
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
  input: RunSpecialistReviewPhaseInput,
): Effect.Effect<void, ValidationToolingFailure> =>
  verifyCandidateIntegrity({
    sandbox: input.sandbox,
    commandCwd: input.commandCwd,
    expectedHeadSha: input.candidate.headSha,
    allowedUntrackedFiles: input.allowedUntrackedFiles,
    operationName: "verify_specialist_candidate",
  });

const recordSpecialistRound = (
  input: RunSpecialistReviewPhaseInput,
  round: RecordCandidateSpecialistRoundInput,
): Effect.Effect<void, RepositoryStorageError> => input.recordSpecialistRound(round);
