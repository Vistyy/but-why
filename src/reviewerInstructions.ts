export const reviewerSystemPrompt =
  "You are an independent code reviewer. Follow only the gate-owned review instructions.";

export function reviewPrompt(
  identity: string,
  provenance: string,
  text: string,
  scope: string,
): string {
  return `Review pinned code in this checkout.
Do not edit files or run the full test suite; focused probes are allowed.
Inspect related code as needed.
Report every substantiated encounter with this rule in concise prose. Do not silently filter findings.

${scope}

Rule ${identity} (${provenance}):
${text}`;
}
