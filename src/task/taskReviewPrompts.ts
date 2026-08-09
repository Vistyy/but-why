import { encodeReviewerWireValue, reviewerOutputTag } from "../agent/reviewerOutputWire.js";
import type { TaskReviewFinding, TaskReviewProposal, TaskReviewProposalKey } from "./taskReview.js";
import type { TaskReviewPolicy } from "./taskReviewPolicy.js";

const taskReviewerExecutionInstructions = [
  "When inspection is insufficient, you may use bash and operating-system temporary space for targeted experiments, generated scripts, fixtures, and other disposable evidence.",
  "You must not modify the repository. The disposable workspace and Task Review base are authoritative.",
].join("\n");

export type TaskReviewHistoryEvidence = {
  readonly reviewId: string;
  readonly outcome: "passed" | "blocked";
  readonly findings: readonly Omit<TaskReviewFinding, "id" | "reviewId" | "createdAt">[];
};

export type TaskReviewPromptInput = {
  readonly reviewId: string;
  readonly baseCommit: string;
  readonly proposal: TaskReviewProposal;
  readonly policy: TaskReviewPolicy;
  readonly priorOutcome?: TaskReviewHistoryEvidence;
  readonly proposalDiff?: string;
};

export const buildTaskReviewerPrompt = (input: TaskReviewPromptInput): string =>
  [
    input.policy.instructions,
    "",
    taskReviewerExecutionInstructions,
    "",
    "Task Review identity:",
    encodeReviewerWireValue({ reviewId: input.reviewId, baseCommit: input.baseCommit }),
    "",
    "Task Context (authoritative proposal under review):",
    encodeReviewerWireValue({
      title: input.proposal.title,
      description: input.proposal.description,
    }),
    "",
    "Direct Task Dependencies (evidence):",
    encodeReviewerWireValue({
      dependencies: input.proposal.dependencies.map((dependency) => ({
        taskId: dependency.taskId,
        title: dependency.title,
        description: dependency.description,
        state: dependency.state,
        dependencyIds: dependency.dependencyIds,
      })),
    }),
    ...(input.proposalDiff === undefined
      ? []
      : ["", "Deterministic proposal diff from the prior reviewed proposal:", input.proposalDiff]),
    ...(input.priorOutcome === undefined
      ? []
      : [
          "",
          "Prior applicable Task Review outcome:",
          encodeReviewerWireValue({
            reviewId: input.priorOutcome.reviewId,
            outcome: input.priorOutcome.outcome,
            findings: input.priorOutcome.findings,
          }),
          "The prior outcome applies to the earlier proposal and is context for this review.",
        ]),
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, evidence, and files.",
  ].join("\n");

export const buildTaskReviewContinuationPrompt = (input: {
  readonly reviewId: string;
  readonly baseCommit: string;
  readonly proposal: TaskReviewProposal;
  readonly priorOutcome?: TaskReviewHistoryEvidence;
  readonly proposalDiff?: string;
}): string =>
  [
    "Continue the Task Reviewer Session for the exact Task Review.",
    "Re-anchor the review to the exact presented Task Context and direct Task Dependencies.",
    ...(input.proposalDiff === undefined
      ? []
      : ["", "Deterministic proposal diff from the prior reviewed proposal:", input.proposalDiff]),
    ...(input.priorOutcome === undefined
      ? []
      : [
          "",
          "Prior applicable Task Review outcome:",
          encodeReviewerWireValue({
            reviewId: input.priorOutcome.reviewId,
            outcome: input.priorOutcome.outcome,
            findings: input.priorOutcome.findings,
          }),
        ]),
    "",
    "Task Review identity:",
    encodeReviewerWireValue({ reviewId: input.reviewId, baseCommit: input.baseCommit }),
    "",
    "Task Context (authoritative proposal under review):",
    encodeReviewerWireValue({
      title: input.proposal.title,
      description: input.proposal.description,
    }),
    "",
    "Direct Task Dependencies (evidence):",
    encodeReviewerWireValue({ dependencies: input.proposal.dependencies }),
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must include title, description, evidence, and files.",
  ].join("\n");

export const deterministicProposalDiff = (
  prior: TaskReviewProposalKey,
  current: TaskReviewProposalKey,
): string => {
  const priorLines = stableProposalLines(prior);
  const currentLines = stableProposalLines(current);
  const diff = lineDiff(priorLines, currentLines);
  return diff.length === 0 ? "" : diff.join("\n");
};

const stableProposalLines = (key: TaskReviewProposalKey): readonly string[] =>
  JSON.stringify(key, Object.keys(key).sort(), 2).split("\n");

const lineDiff = (prior: readonly string[], current: readonly string[]): readonly string[] => {
  const priorPrefix = "- ";
  const currentPrefix = "+ ";
  const contextPrefix = "  ";
  const common = longestCommonSubsequence(prior, current);
  const output: string[] = [];
  let priorIndex = 0;
  let currentIndex = 0;
  for (const commonLine of common) {
    while (priorIndex < prior.length && prior[priorIndex] !== commonLine) {
      output.push(`${priorPrefix}${prior[priorIndex]}`);
      priorIndex += 1;
    }
    while (currentIndex < current.length && current[currentIndex] !== commonLine) {
      output.push(`${currentPrefix}${current[currentIndex]}`);
      currentIndex += 1;
    }
    output.push(`${contextPrefix}${commonLine}`);
    priorIndex += 1;
    currentIndex += 1;
  }
  while (priorIndex < prior.length) {
    output.push(`${priorPrefix}${prior[priorIndex]}`);
    priorIndex += 1;
  }
  while (currentIndex < current.length) {
    output.push(`${currentPrefix}${current[currentIndex]}`);
    currentIndex += 1;
  }
  return output;
};

const longestCommonSubsequence = (
  left: readonly string[],
  right: readonly string[],
): readonly string[] => {
  const widths = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );
  const width = (i: number, j: number): number => widths[i]?.[j] ?? 0;
  const setWidth = (i: number, j: number, value: number): void => {
    const row = widths[i];
    if (row !== undefined) row[j] = value;
  };
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      setWidth(
        i,
        j,
        left[i] === right[j] ? width(i + 1, j + 1) + 1 : Math.max(width(i + 1, j), width(i, j + 1)),
      );
    }
  }
  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      const match = left[i];
      if (match !== undefined) result.push(match);
      i += 1;
      j += 1;
    } else if (width(i + 1, j) >= width(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
};
