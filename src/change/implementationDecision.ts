export type ImplementationDecision = {
  readonly id: string;
  readonly changeId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly choice: string;
  readonly rationale: string;
};

export type ImplementationDecisionInputError =
  | { readonly code: "empty_choice" | "empty_rationale" | "invalid_choice" | "invalid_rationale" }
  | { readonly code: "choice_too_long"; readonly maxCharacters: 160 }
  | { readonly code: "rationale_too_long"; readonly maxCharacters: 600 }
  | { readonly code: "rationale_sentence_count"; readonly min: 1; readonly max: 3 };

const controlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });

export const validateImplementationDecisionInput = (input: {
  readonly choice: string;
  readonly rationale: string;
}): ImplementationDecisionInputError | undefined => {
  if (input.choice.trim().length === 0) return { code: "empty_choice" };
  if (input.rationale.trim().length === 0) return { code: "empty_rationale" };
  if (
    controlCharacter(input.choice) ||
    input.choice.includes("\n") ||
    containsMarkdown(input.choice)
  )
    return { code: "invalid_choice" };
  if (controlCharacter(input.rationale) || containsMarkdown(input.rationale))
    return { code: "invalid_rationale" };
  if ([...input.choice].length > 160) return { code: "choice_too_long", maxCharacters: 160 };
  if ([...input.rationale].length > 600) return { code: "rationale_too_long", maxCharacters: 600 };
  const sentences = input.rationale.trim().split(/(?<=[.!?])\s+/u);
  if (sentences.length < 1 || sentences.length > 3)
    return { code: "rationale_sentence_count", min: 1, max: 3 };
  return undefined;
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

const containsMarkdown = (value: string): boolean =>
  /```|`|\*\*|__|~~|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|^#{1,6}\s|^>\s|^\s*(?:[-+*]|\d+[.)])\s/mu.test(
    value,
  );

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("~", "\\~")
    .replaceAll("- ", "\\- ")
    .replaceAll("+ ", "\\+ ")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
