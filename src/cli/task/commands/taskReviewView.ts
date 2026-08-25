import type { PiAgentProfileConfig, PiRuntimeConfig } from "../../../contracts/agentConfig.js";
import type {
  TaskReviewPolicySnapshot,
  TaskReviewRecord,
} from "../../../task/review/taskReview.js";
import type { TaskReviewIdentityInspection } from "../../../task/review/taskReviewUseCases.js";
import { agentInvocationView } from "../../agentInvocationView.js";

export const taskReviewHistoryView = (review: TaskReviewRecord) => ({
  id: review.id,
  state: review.state,
  outcome: review.outcome,
  findingCount: review.findings.length,
  toolingFailure:
    review.toolingFailure === null ? null : { operation: review.toolingFailure.operation },
  workspaceCleanup: review.workspaceCleanup,
  agentInvocationCount: review.agentInvocations?.length ?? 0,
  nextActions: [`Run \`by task-review show ${review.id}\` to inspect this Review.`],
});

export const taskReviewView = (
  review: TaskReviewRecord,
  proposalCurrent?: boolean,
  identity?: TaskReviewIdentityInspection,
) => ({
  id: review.id,
  taskId: review.taskId,
  state: review.state,
  outcome: review.outcome,
  proposal: review.proposal,
  proposalCurrent: proposalCurrent ?? null,
  dependencyEvidence: review.dependencyEvidence,
  reviewerConfiguration:
    review.reviewerConfiguration === undefined
      ? null
      : taskReviewPolicyView(review.reviewerConfiguration),
  reviewBase: { ref: review.baseRef, commit: review.baseCommit },
  workspace: {
    path: review.workspacePath,
    cleanup: review.workspaceCleanup,
    blockingReason: review.cleanupBlockingReason,
  },
  ...(identity === undefined ? {} : { identity }),
  findings: review.findings,
  findingCount: review.findings.length,
  toolingFailure:
    review.toolingFailure === null
      ? null
      : {
          operation: review.toolingFailure.operation,
          message: review.toolingFailure.message,
        },
  recovery: {
    workspaceCleanup: review.workspaceCleanup,
    blockingReason: review.cleanupBlockingReason,
    failedOperation: review.toolingFailure?.operation ?? null,
    nextActions: taskReviewRecoveryActions(review, identity),
  },
  agentSession: {
    id: review.agentSessionId ?? null,
    invocations: (review.agentInvocations ?? []).map(agentInvocationView),
  },
  ...(review.simplificationAdviceAttempt === undefined
    ? {}
    : {
        simplificationAdviceAttempt:
          review.simplificationAdviceAttempt === null
            ? null
            : {
                state: review.simplificationAdviceAttempt.state,
                advice: review.simplificationAdviceAttempt.advice,
                unavailable: review.simplificationAdviceAttempt.unavailable,
                configuration:
                  review.simplificationAdviceAttempt.configuration === null
                    ? null
                    : simplificationAdvicePolicyView(
                        review.simplificationAdviceAttempt.configuration,
                      ),
                agentSession: {
                  id: review.simplificationAdviceAttempt.agentSessionId ?? null,
                  invocations: (review.simplificationAdviceAttempt.agentInvocations ?? []).map(
                    agentInvocationView,
                  ),
                },
              },
      }),
});

const taskReviewRecoveryActions = (
  review: TaskReviewRecord,
  identity: TaskReviewIdentityInspection | undefined,
): readonly string[] => {
  if (review.state !== "running") return [];
  if (identity === undefined)
    return [`Run \`by task-review show ${review.id}\` to inspect recovery.`];
  if (!identity.verified) return ["Resolve the reported Task Review identity problem."];
  return [
    "Stop the Task Review process before abandonment.",
    `Run \`by task review abandon ${review.id} --reason "..."\` after the process stops.`,
  ];
};

const simplificationAdvicePolicyView = (policy: {
  readonly profile: TaskReviewPolicySnapshot["profile"];
  readonly builtInInstructions: string;
}) => ({
  profile: taskReviewProfileView(policy.profile),
  builtInInstructions: policy.builtInInstructions,
});

const taskReviewPolicyView = (policy: TaskReviewPolicySnapshot) => ({
  profile: taskReviewProfileView(policy.profile),
  builtInInstructions: policy.builtInInstructions,
  guidance: policy.guidance,
});

export const taskReviewProfileView = (profile: TaskReviewPolicySnapshot["profile"]) => ({
  agentProfile: profile.agentProfile,
  scope: profile.scope,
  profile: profile.profile === null ? null : piAgentProfileView(profile.profile),
});

const piAgentProfileView = (profile: PiAgentProfileConfig) => ({
  agentRuntime: profile.agentRuntime,
  ...(profile.runtimeConfig === undefined
    ? {}
    : { runtimeConfig: piRuntimeConfigView(profile.runtimeConfig) }),
});

const piRuntimeConfigView = (runtime: PiRuntimeConfig) => ({
  ...(runtime.model === undefined ? {} : { model: runtime.model }),
  ...(runtime.thinking === undefined ? {} : { thinking: runtime.thinking }),
  ...(runtime.extensions === undefined ? {} : { extensions: runtime.extensions }),
  ...(runtime.skills === undefined ? {} : { skills: runtime.skills }),
  ...(runtime.tools === undefined ? {} : { tools: runtime.tools }),
  ...(runtime.contextFileDiscovery === undefined
    ? {}
    : { contextFileDiscovery: runtime.contextFileDiscovery }),
});
