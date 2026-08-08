import { Schema } from "effect";

export const implementationDecisionSchema = Schema.Struct({
  id: Schema.String,
  changeId: Schema.String,
  sequence: Schema.Number,
  recordedAt: Schema.String,
  choice: Schema.String,
  rationale: Schema.String,
});

export const implementationDecisionSnapshotSchema = Schema.Array(implementationDecisionSchema);

export type ImplementationDecision = Schema.Schema.Type<typeof implementationDecisionSchema>;

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
        .map(
          (decision) =>
            `<details>\n<summary>${escapeHtml(decision.choice)}</summary>\n\n${escapeHtml(decision.rationale)}\n\n</details>`,
        )
        .join("\n\n");
