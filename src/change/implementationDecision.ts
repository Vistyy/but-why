export type ImplementationDecision = {
  readonly id: string;
  readonly changeId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly choice?: string;
  readonly rationale?: string;
  /** Present only when loading a pre-structured decision. */
  readonly content?: string;
};

const escapeHtml = (value: string): string => {
  const entities: Readonly<Record<string, string>> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/gu, (character) => entities[character] ?? character);
};

export const implementationDecisionMarkdown = (
  decisions: readonly ImplementationDecision[],
): string =>
  decisions.length === 0
    ? "_No Implementation Decisions recorded._"
    : decisions
        .map((decision) =>
          decision.content !== undefined
            ? `### Decision ${decision.sequence}\n\n${decision.content}`
            : `<details>\n<summary>${escapeHtml(decision.choice ?? "")}</summary>\n\n${escapeHtml(decision.rationale ?? "")}\n\n</details>`,
        )
        .join("\n\n");
