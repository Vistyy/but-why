export const ruleAuthoringInstructions = `# Writing a But Why rule

But Why runs one independent reviewer per Markdown rule and reports prose, not pass/fail. A rule cannot guarantee that a model will find every violation.

## Decide whether a rule belongs here

Start with an observed recurring code problem, whether introduced by a change or already present, and a similar legitimate case. Check whether clearer code, a test, or deterministic lint can distinguish them more reliably. Use a semantic rule only when the remaining decision needs context. Project rules support a bounded trial; global rules run another model session on every review, even in unrelated repositories.

## State one judgment

Write a rule in .but-why/rules/<name>.md for the project or <Pi agent directory>/but-why/rules/<name>.md globally. State:

- The failure it protects against and why that failure matters to someone maintaining the current code. Describe the cost or risk, not the history of the change that prompted the rule.
- The code and relationships to inspect, including changes that invalidate a previously sound assumption. A finding need not be caused by or located in the diff.
- An observable violation threshold and the rule-specific evidence needed to cross it. For a design or readability rule, identify the concrete current maintenance cost and what would make an alternative materially clearer; a preference alone is not a violation.
- A close violation and legitimate near-miss showing where the threshold falls. Name the actual constraint or code evidence that distinguishes the near-miss; an existing or repeated pattern, a comment, or an assumed intent does not justify an exception. For example, an unchecked provider value cast before field access differs from a cast after validation of the consumed fields.
- The rule-specific evidence a finding must identify, and a correction direction that addresses the underlying problem without requiring one syntax or helper when several sound implementations exist.

Leave shared reviewer duties to But Why: inspection, evidence-based findings, treatment of unresolved candidates, disclosure of coverage, and reporting no violations. A rule should specify its particular judgment, not duplicate the reviewer's general instructions.

## Calibrate before relying on it

Try the draft against both examples and one different real boundary. Inspect the reviewer's exact output and the code; revise the rule when it misses a violation or flags a legitimate case. Use by review files --at SHA <path> to load a rule at the audited commit. For by review change --base BASE --head HEAD, project rules come from BASE: a rule first added in HEAD cannot judge that change. One successful trial is bounded evidence, not a reliability guarantee. Keep a rule project-local until its broader cost and false-positive behavior justify making it global.
`;
