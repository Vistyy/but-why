import type { PiAgentProfileConfig, PiRuntimeConfig } from "../../../contracts/agentConfig.js";
import type {
  TaskReviewPolicySnapshot,
  TaskReviewRecord,
} from "../../../task/review/taskReview.js";
import type { TaskReviewIdentityInspection } from "../../../task/review/taskReviewUseCases.js";

export const taskReviewHistoryView = (review: TaskReviewRecord) => ({
  id: review.id,
  state: review.state,
  outcome: review.outcome,
  findingCount: review.findings.length,
  toolingFailure:
    review.toolingFailure === null ? null : { operation: review.toolingFailure.operation },
  workspaceCleanup: review.workspaceCleanup,
  sessionCount: review.sessions.length,
  transcriptCount: review.transcripts.length,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
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
  policy: taskReviewPolicyView(review.policy),
  reviewBase: { ref: review.baseRef, commit: review.baseCommit },
  workspace: { path: review.workspacePath, cleanup: review.workspaceCleanup },
  ...(identity === undefined ? {} : { identity }),
  findings: review.findings,
  findingCount: review.findings.length,
  toolingFailure: review.toolingFailure,
  recovery: {
    workspaceCleanup: review.workspaceCleanup,
    failedOperation: review.toolingFailure?.operation ?? null,
    nextActions: taskReviewRecoveryActions(review, identity),
  },
  sessions: review.sessions,
  transcripts: review.transcripts,
  abandonReason: review.abandonReason,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
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

const taskReviewPolicyView = (policy: TaskReviewPolicySnapshot) => ({
  profile: taskReviewProfileView(policy.profile),
  builtInInstructions: policy.builtInInstructions,
  guidance: policy.guidance,
});

const taskReviewProfileView = (profile: TaskReviewPolicySnapshot["profile"]) => ({
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
