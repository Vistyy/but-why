export type ImplementationDecision = {
  readonly id: string;
  readonly changeId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly content: string;
};

export const implementationDecisionMarkdown = (
  decisions: readonly ImplementationDecision[],
): string =>
  decisions.length === 0
    ? "_No Implementation Decisions recorded._"
    : decisions
        .map(
          (decision) =>
            `### Decision ${decision.sequence}\n\n${decision.content}\n\n<!-- ${decision.id} recorded ${decision.recordedAt} -->`,
        )
        .join("\n\n");
