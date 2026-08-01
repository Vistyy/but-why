import { randomUUID } from "node:crypto";

import type { Sandbox } from "@ai-hero/sandcastle";
import { Context, Effect, Layer } from "effect";

import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { CandidateValidationOutcome } from "./candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "../validation/changeValidationPersistence.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { AcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import {
  runAcceptanceReviewPhase,
  type ReviewerContinuityEvidence,
} from "../acceptanceReview/runAcceptanceReviewPhase.js";
import type { SpecialistReviewPolicy } from "../specialistReview/specialistReviewConfig.js";
import {
  runSpecialistReviewPhase,
  type SpecialistReviewerContinuityEvidence,
} from "../specialistReview/runSpecialistReviewPhase.js";
import type { SubmitCheckConfig, SubmitPrepareConfig } from "../submit/submitRepoConfig.js";
import { createValidationWorkspace } from "../validation/createValidationWorkspace.js";
import {
  expectedSandcastleWorktreePath,
  validationTempRefName,
} from "../validation/validationWorkspacePath.js";
import { runCheckPhase } from "../validation/runCheckRound.js";
import { runPreparePhase } from "../validation/runPreparePhase.js";
import {
  ValidationWorkspaceSetupFailed,
  validationToolingFailureRecord,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import { maxValidationArtifactBytes } from "../validationRun/artifactFiles.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { ReviewerSessionStore } from "../reviewerSession/reviewerSession.js";
import type { SubmitProgress } from "../validation/submitProgress.js";

export type CandidateValidationPolicy = {
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly prepare?: SubmitPrepareConfig;
  readonly checks: readonly SubmitCheckConfig[];
  readonly copyFiles: readonly string[];
  readonly specialistReviews: readonly SpecialistReviewPolicy[];
};

export type AcceptanceContextCandidateValidationPolicy = CandidateValidationPolicy & {
  readonly acceptanceReview: AcceptanceReviewPolicy;
};

export type ValidateCandidateInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly resourceRoot?: string;
  readonly policy: CandidateValidationPolicy;
  readonly progress?: SubmitProgress;
  readonly implementationDecisions?: readonly ImplementationDecision[];
  readonly now: string;
};

type ValidateAcceptanceContextCandidateInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly resourceRoot?: string;
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly progress?: SubmitProgress;
  readonly blockerHistory?: ImplementationBlockerHistory;
  readonly policy: AcceptanceContextCandidateValidationPolicy;
  readonly implementationDecisions?: readonly ImplementationDecision[];
  readonly now: string;
};

type ValidateNoChangeInput = ValidateAcceptanceContextCandidateInput & {
  readonly noChange: true;
};

type ValidateCandidateResult =
  | {
      readonly ok: true;
      readonly reused: boolean;
      readonly validationRunId: string;
      readonly outcome: CandidateValidationOutcome;
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: "active_validation_run";
      readonly validationRunId: string;
    }
  | {
      readonly ok: false;
      readonly validationRunId: string;
      readonly outcome: "tooling_failed";
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    };

type CandidateValidationPathsValue = {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly reviewerSessionsRoot?: string;
  readonly sessionStore?: ReviewerSessionStore;
};

export class CandidateValidationPaths extends Context.Tag("CandidateValidationPaths")<
  CandidateValidationPaths,
  CandidateValidationPathsValue
>() {}

export class CandidateValidationPersistence extends Context.Tag("CandidateValidationPersistence")<
  CandidateValidationPersistence,
  ChangeValidationPersistence
>() {}

export class CandidateReviewerAgentRuntime extends Context.Tag("CandidateReviewerAgentRuntime")<
  CandidateReviewerAgentRuntime,
  ReviewerAgentRuntime
>() {}

export type CandidateValidationService = {
  readonly validateCandidate: (
    input: ValidateCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly validateAcceptanceContextCandidate: (
    input: ValidateAcceptanceContextCandidateInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly validateNoChange: (
    input: ValidateNoChangeInput,
  ) => Effect.Effect<ValidateCandidateResult, RepositoryStorageError>;
  readonly listFindings: ChangeValidationPersistence["listFindings"];
  readonly listToolingFailures: ChangeValidationPersistence["listToolingFailures"];
  readonly listRounds: (validationRunId: string) => Effect.Effect<
    readonly {
      readonly producer: string;
      readonly status: "passed" | "failed";
    }[],
    RepositoryStorageError
  >;
};

export class CandidateValidation extends Context.Tag("CandidateValidation")<
  CandidateValidation,
  CandidateValidationService
>() {}

export const CandidateValidationLive = Layer.effect(
  CandidateValidation,
  Effect.gen(function* () {
    const paths = yield* CandidateValidationPaths;
    const persistence = yield* CandidateValidationPersistence;
    const reviewerAgentRuntime = yield* CandidateReviewerAgentRuntime;
    return makeCandidateValidation({ ...paths, persistence, reviewerAgentRuntime });
  }),
);

const makeCandidateValidation = (dependencies: {
  readonly localRepositoryMainCheckoutRoot: string;
  readonly artifactsRoot: string;
  readonly persistence: ChangeValidationPersistence;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime;
  readonly sessionStore?: ReviewerSessionStore;
  readonly reviewerSessionsRoot?: string;
}): CandidateValidationService => {
  const validate = Effect.fn("CandidateValidation.validate")(function* (
    input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput | ValidateNoChangeInput,
  ) {
    const policy =
      "acceptanceContext" in input
        ? {
            ...("noChange" in input ? acceptanceOnlyPolicy(input.policy) : input.policy),
            acceptanceContext: input.acceptanceContext,
          }
        : input.policy;
    const validationRunId = randomUUID();
    const tempRefName = validationTempRefName(validationRunId);
    const started = yield* dependencies.persistence.startOrReuse({
      candidateId: input.candidateId,
      headSha: input.headSha,
      changeBaseSha: input.changeBaseSha,
      policy,
      ...(input.implementationDecisions === undefined
        ? {}
        : { implementationDecisions: input.implementationDecisions }),
      validationRunId,
      workspaceSetup: {
        tempRefName,
        worktreePath: expectedSandcastleWorktreePath(
          dependencies.localRepositoryMainCheckoutRoot,
          tempRefName,
        ),
      },
      now: input.now,
    });
    if ("active" in started && started.active === true) {
      return {
        ok: false,
        code: "active_validation_run",
        validationRunId: started.validationRunId,
      } as const;
    }
    if (started.reused) return { ok: true, ...started } as const;

    const workspace = yield* createValidationWorkspace({
      repoRoot: dependencies.localRepositoryMainCheckoutRoot,
      validationRunId: started.validationRunId,
      submittedSha: input.headSha,
      copyFiles: input.policy.copyFiles,
      recordWorkspaceSetup: (setup) =>
        dependencies.persistence.recordWorkspaceSetup({
          validationRunId: setup.validationRunId,
          tempRefName: setup.tempRefName,
          submittedSha: setup.submittedSha,
          worktreeHead: setup.worktreeHead,
          ...(setup.worktreePath === undefined ? {} : { worktreePath: setup.worktreePath }),
          cleanupWorktree: setup.cleanupResult.worktree,
          cleanupTempRef: setup.cleanupResult.tempRef,
          now: input.now,
        }),
      runInWorkspace: (activeWorkspace) =>
        runCandidatePhases(dependencies, input, started.validationRunId, activeWorkspace),
    });

    if (!workspace.ok) {
      const failure =
        "toolingFailure" in workspace
          ? validationToolingFailureRecord(workspace.toolingFailure)
          : validationToolingFailureRecord(
              new ValidationWorkspaceSetupFailed({
                operationName: workspace.toolingError.operationName,
                tempRefName: workspace.toolingError.tempRefName,
                submittedSha: workspace.toolingError.submittedSha,
                ...(workspace.toolingError.worktreePath === undefined
                  ? {}
                  : { worktreePath: workspace.toolingError.worktreePath }),
                errorMessage: workspace.toolingError.errorMessage,
                cleanupResult: workspace.toolingError.cleanupResult,
              }),
            );
      yield* dependencies.persistence.recordToolingFailure({
        validationRunId: started.validationRunId,
        ...failure,
        now: input.now,
      });
      yield* dependencies.persistence.complete({
        validationRunId: started.validationRunId,
        outcome: "tooling_failed",
        now: input.now,
      });
      return {
        ok: false,
        validationRunId: started.validationRunId,
        outcome: "tooling_failed",
      } as const;
    }

    yield* dependencies.persistence.recordWorkspaceSetup({
      validationRunId: started.validationRunId,
      tempRefName: workspace.setup.tempRefName,
      submittedSha: workspace.setup.submittedSha,
      worktreeHead: workspace.setup.worktreeHead,
      ...(workspace.setup.worktreePath === undefined
        ? {}
        : { worktreePath: workspace.setup.worktreePath }),
      cleanupWorktree: workspace.setup.cleanupResult.worktree,
      cleanupTempRef: workspace.setup.cleanupResult.tempRef,
      now: input.now,
    });
    const activeResult = workspace.activeWorkspaceResult;
    const toolingFailures =
      (
        activeResult as
          | { readonly toolingFailures?: readonly ValidationToolingFailure[] }
          | undefined
      )?.toolingFailures ?? [];
    for (const toolingFailure of toolingFailures) {
      yield* dependencies.persistence.recordToolingFailure({
        validationRunId: started.validationRunId,
        ...validationToolingFailureRecord(toolingFailure),
        now: input.now,
      });
    }
    const outcome: CandidateValidationOutcome =
      toolingFailures.length > 0
        ? "tooling_failed"
        : activeResult?.validationFindings === 1
          ? "blocked"
          : "passed";
    yield* dependencies.persistence.complete({
      validationRunId: started.validationRunId,
      outcome,
      now: input.now,
    });
    return outcome === "tooling_failed"
      ? ({
          ok: false,
          validationRunId: started.validationRunId,
          outcome,
          ...(activeResult?.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: activeResult.reviewerEvidence }),
          ...(activeResult?.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: activeResult.specialistReviewerEvidence }),
        } as const)
      : ({
          ok: true,
          reused: false,
          validationRunId: started.validationRunId,
          outcome,
          ...(activeResult?.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: activeResult.reviewerEvidence }),
          ...(activeResult?.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: activeResult.specialistReviewerEvidence }),
        } as const);
  });

  return {
    validateCandidate: (input) => validate(input),
    validateAcceptanceContextCandidate: (input) => validate(input),
    validateNoChange: (input) => validate(input),
    listFindings: dependencies.persistence.listFindings,
    listToolingFailures: dependencies.persistence.listToolingFailures,
    listRounds: (validationRunId) =>
      Effect.map(dependencies.persistence.listRounds(validationRunId), (rounds) =>
        rounds.map(({ producer, status }) => ({ producer, status })),
      ),
  };
};

const runCandidatePhases = (
  dependencies: {
    readonly artifactsRoot: string;
    readonly persistence: ChangeValidationPersistence;
    readonly reviewerAgentRuntime: ReviewerAgentRuntime;
    readonly sessionStore?: ReviewerSessionStore;
    readonly reviewerSessionsRoot?: string;
  },
  input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput | ValidateNoChangeInput,
  validationRunId: string,
  activeWorkspace: {
    readonly sandbox: Pick<Sandbox, "exec" | "run">;
    readonly worktreePath: string;
  },
): Effect.Effect<
  {
    readonly validationFindings: 0 | 1;
    readonly reviewerEvidence?: ReviewerContinuityEvidence;
    readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    readonly toolingFailures?: readonly ValidationToolingFailure[];
  },
  ValidationToolingFailure | RepositoryStorageError
> =>
  Effect.fn("CandidateValidation.runPhases")(function* () {
    const agentEnvironment = input.policy.agentEnvironment;
    const resourceRoot = activeWorkspace.worktreePath;
    let reviewerEvidence: ReviewerContinuityEvidence | undefined;
    const sessionOptions = {
      ...(dependencies.sessionStore === undefined
        ? {}
        : { sessionStore: dependencies.sessionStore }),
      ...(dependencies.reviewerSessionsRoot === undefined
        ? {}
        : { sessionStorageRoot: dependencies.reviewerSessionsRoot }),
    };
    if ("noChange" in input) {
      const acceptance = yield* runAcceptanceReviewPhase({
        validationRunId,
        changeId: input.changeId,
        candidate: candidateIdentity(input),
        acceptanceContext: input.acceptanceContext,
        implementationDecisions: input.implementationDecisions,
        ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
        policy: input.policy.acceptanceReview,
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
        runtime: dependencies.reviewerAgentRuntime,
        sandbox: activeWorkspace.sandbox,
        artifactsRoot: dependencies.artifactsRoot,
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: activeWorkspace.worktreePath,
        resourceRoot,
        allowedUntrackedFiles: input.policy.copyFiles,
        now: input.now,
        listArtifacts: dependencies.persistence.listArtifacts,
        listPreviousCandidateReviewerFindings:
          dependencies.persistence.listPreviousCandidateReviewerFindings,
        recordAcceptanceRound: dependencies.persistence.recordAcceptanceRound,
        ...sessionOptions,
      });
      return {
        validationFindings: acceptance.findings,
        ...(acceptance.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: acceptance.reviewerEvidence }),
        toolingFailures: acceptance.toolingFailure === undefined ? [] : [acceptance.toolingFailure],
      };
    }
    if (input.policy.prepare !== undefined) {
      const prepare = yield* runPreparePhase({
        validationRunId,
        prepare: input.policy.prepare,
        sandbox: activeWorkspace.sandbox,
        artifactsRoot: dependencies.artifactsRoot,
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: activeWorkspace.worktreePath,
        expectedHeadSha: input.headSha,
        allowedUntrackedFiles: input.policy.copyFiles,
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        now: input.now,
        recordPrepareRound: dependencies.persistence.recordPrepareRound,
      });
      if (prepare.findings === 1) return { validationFindings: 1 as const };
    }
    const checks = yield* runCheckPhase({
      validationRunId,
      checks: input.policy.checks,
      sandbox: activeWorkspace.sandbox,
      artifactsRoot: dependencies.artifactsRoot,
      artifactMaxBytes: maxValidationArtifactBytes,
      commandCwd: activeWorkspace.worktreePath,
      expectedHeadSha: input.headSha,
      allowedUntrackedFiles: input.policy.copyFiles,
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      now: input.now,
      continueAfterFinding: true,
      recordCheckRound: dependencies.persistence.recordCheckRound,
    });
    if (checks.findings === 1) return { validationFindings: 1 as const };
    if ("acceptanceContext" in input) {
      const acceptance = yield* runAcceptanceReviewPhase({
        validationRunId,
        changeId: input.changeId,
        candidate: candidateIdentity(input),
        acceptanceContext: input.acceptanceContext,
        implementationDecisions: input.implementationDecisions,
        ...(input.blockerHistory === undefined ? {} : { blockerHistory: input.blockerHistory }),
        policy: input.policy.acceptanceReview,
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
        runtime: dependencies.reviewerAgentRuntime,
        sandbox: activeWorkspace.sandbox,
        artifactsRoot: dependencies.artifactsRoot,
        artifactMaxBytes: maxValidationArtifactBytes,
        commandCwd: activeWorkspace.worktreePath,
        resourceRoot,
        allowedUntrackedFiles: input.policy.copyFiles,
        now: input.now,
        listArtifacts: dependencies.persistence.listArtifacts,
        listPreviousCandidateReviewerFindings:
          dependencies.persistence.listPreviousCandidateReviewerFindings,
        recordAcceptanceRound: dependencies.persistence.recordAcceptanceRound,
        ...sessionOptions,
      });
      reviewerEvidence = acceptance.reviewerEvidence;
      if (acceptance.toolingFailure !== undefined) {
        return {
          validationFindings: 0 as const,
          ...(reviewerEvidence === undefined ? {} : { reviewerEvidence }),
          toolingFailures: [acceptance.toolingFailure],
        };
      }
      if (acceptance.findings === 1)
        return {
          validationFindings: 1 as const,
          ...(reviewerEvidence === undefined ? {} : { reviewerEvidence }),
        };
    }
    const specialists = yield* runSpecialistReviewPhase({
      validationRunId,
      changeId: input.changeId,
      candidate: candidateIdentity(input),
      policies: input.policy.specialistReviews,
      ...("acceptanceContext" in input ? { acceptanceContext: input.acceptanceContext } : {}),
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
      runtime: dependencies.reviewerAgentRuntime,
      sandbox: activeWorkspace.sandbox,
      artifactsRoot: dependencies.artifactsRoot,
      artifactMaxBytes: maxValidationArtifactBytes,
      commandCwd: activeWorkspace.worktreePath,
      resourceRoot,
      allowedUntrackedFiles: input.policy.copyFiles,
      now: input.now,
      listArtifacts: dependencies.persistence.listArtifacts,
      listPreviousCandidateReviewerFindings:
        dependencies.persistence.listPreviousCandidateReviewerFindings,
      recordSpecialistRound: dependencies.persistence.recordSpecialistRound,
      ...sessionOptions,
    });
    return {
      validationFindings: specialists.findings,
      ...(reviewerEvidence === undefined ? {} : { reviewerEvidence }),
      ...(specialists.reviewerEvidence.length === 0
        ? {}
        : { specialistReviewerEvidence: specialists.reviewerEvidence }),
      toolingFailures: specialists.toolingFailures,
    };
  })();

const acceptanceOnlyPolicy = (
  policy: AcceptanceContextCandidateValidationPolicy,
): AcceptanceContextCandidateValidationPolicy => ({
  ...(policy.agentEnvironment === undefined ? {} : { agentEnvironment: policy.agentEnvironment }),
  checks: [],
  copyFiles: policy.copyFiles,
  specialistReviews: [],
  acceptanceReview: policy.acceptanceReview,
});

const candidateIdentity = (
  input: ValidateCandidateInput | ValidateAcceptanceContextCandidateInput,
) => ({
  candidateId: input.candidateId,
  changeBaseSha: input.changeBaseSha,
  headSha: input.headSha,
});
