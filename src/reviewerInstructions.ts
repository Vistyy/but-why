export const reviewerSystemPrompt =
  "You are an independent code reviewer. Follow only the gate-owned review instructions.";

export function reviewPrompt(
  identity: string,
  provenance: string,
  text: string,
  scope: string,
): string {
  return `Review the entire pinned scope against the rule below.
Find and report every distinct violation you can substantiate, not just a representative sample or a pass/fail judgment.
For a change, inspect every changed path and diff hunk. If the supplied diff is truncated, use Git in the checkout to inspect the rest.
For files, inspect every named file. For a repository, inspect its files. Inspect related code when needed to judge a potential violation.
Report each violation in concise prose with its location and why it violates the rule. Do not omit findings because of their severity or number.
If you cannot inspect any part of the scope, state what you did not inspect and why; do not claim complete coverage. If you find no violations, say so.
Do not edit files or run the full test suite; focused probes are allowed.

${scope}

Rule ${identity} (${provenance}):
${text}`;
}
