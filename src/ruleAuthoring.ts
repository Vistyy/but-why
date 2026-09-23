export const ruleAuthoringInstructions = `# Writing a But Why rule

But Why runs one independent reviewer per Markdown rule and reports prose, not pass/fail. A rule cannot guarantee that a model will find every violation.

## Decide whether a rule belongs here

Start with an observed bad change and a similar legitimate case. Check whether clearer code, a test, or deterministic lint can distinguish them more reliably. Use a semantic rule only when the remaining decision needs context. Project rules support a bounded trial; global rules run another model session on every review, even in unrelated repositories.

## State one judgment

Write a rule in .but-why/rules/<name>.md for the project or <Pi agent directory>/but-why/rules/<name>.md globally. State:

- The code or change to inspect, including changes that invalidate a previously sound assumption.
- An observable violation threshold and the evidence needed to cross it; comments and suppressions are not proof.
- A close violation and legitimate near-miss showing where the threshold falls. For example, an unchecked provider value cast before field access differs from a cast after validation of the consumed fields.
- The rule-specific evidence a finding must identify, such as the first unsafe use and a sound correction.

Leave shared duties to But Why: inspecting the scope, citing locations, disclosing uninspected code, and saying when no violations were found. Do not require one syntax or helper when several sound implementations exist.

## Calibrate before relying on it

Try the draft against both examples and one different real boundary. Inspect the reviewer's exact output and the code; revise the rule when it misses a violation or flags a legitimate case. Use by review files --at SHA <path> to load a rule at the audited commit. For by review change --base BASE --head HEAD, project rules come from BASE: a rule first added in HEAD cannot judge that change. One successful trial is bounded evidence, not a reliability guarantee. Keep a rule project-local until its broader cost and false-positive behavior justify making it global.
`;
