# Verification concern

Review the exact Candidate for false confidence in changed or directly affected supported behavior.
Treat affected existing checks and observations as unverified evidence, not a protected baseline.
Candidate evidence comes from the exact Candidate and relevant environment.
Durable coverage protects behavior that should continue to work.

## 1. Understand what must be true

Use these authorities in order:

1. Supplied Acceptance Context defines approved behavior and required verification.
2. `VERIFICATION.md` owns project-wide evidence constraints and recurring material risks.
3. `docs/tooling.md` defines supported mechanisms and workflow ownership.
4. `CONTEXT-MAP.md`, linked contexts, accepted ADRs, and `docs/architecture.md` define behavior, ownership, and boundaries.
5. Candidate diff, affected code and verification, Check Artifacts, and owners provide repository evidence.

When affected work changes a risk or evidence boundary described by `VERIFICATION.md`, read that file from the exact Candidate and check it for semantic drift.
If approved facts make it stale, require correction in the same Candidate.
If a needed project-wide decision has no authority, expose that missing decision instead of inventing strategy.
Do not demand `VERIFICATION.md` updates for unrelated work.

Requirements define the accepted result.
Executable workflows own mandatory gates; complete each mandatory gate through its owner.
Expose material authority conflicts instead of silently resolving them.
Passing Check Artifacts show execution only; they do not by themselves establish supported behavior or prove a boundary.
If no supported observation can establish a required result, expose the unresolved requirement, design, or capability.

## 2. Falsify affected evidence

Search all directly affected existing verification, including unchanged checks.
For each affected check, identify the supported behavior or important failure it must protect or detect, then imagine a plausible important wrong implementation.
Ask whether that implementation would pass and whether a valid implementation would fail on incidental structure.
Prefer evidence independent enough from implementation logic under review that a wrong implementation can fail it.
Evidence must cross the real boundary when behavior depends on it.
Trace affected normal and recovery behavior.
Count rejection or recovery as protection only when evidence shows that it prevents, contains, or recovers from the important consequence.
Check provenance, configuration, realistic fixtures, and sensitive assertions.

## 3. Use the simplest reliable check

Use direct supported Candidate evidence at proportionate execution, diagnosis, coupling, and maintenance cost.
When an integration changes, run one normal operation through the exact Candidate implementation and real dependency, not a test double.
A component or failure check does not prove normal operation.
Missing, malformed, unavailable, or inapplicable evidence is unknown, not success.
Report failed mechanisms and remaining uncertainty.

## 4. Decide separately whether coverage belongs permanently

Durable coverage protects enduring behavior, not Candidate-specific implementation or transition constraints.
Do not require a durable test by default.
Add automation only when it repeatedly catches a plausible important regression missed by retained or one-time evidence and is worth its maintenance cost.
Keep the smallest sufficient affected portfolio.
Update, reuse, consolidate, or remove evidence when that gives sufficient confidence at lower cost.
Remove affected checks that protect no enduring supported behavior when their maintenance cost or coupling is material.
Do not preserve or add checks merely because they exist or production code changed.
Decide that durable coverage is justified before selecting its boundary, and do not broaden the boundary to justify coverage.

Treat retirement and removal as Change-specific by default.
Verify retirement and leave-untouched constraints with Candidate evidence without retaining the retired concept as product knowledge.
Only an independently authorized ongoing compatibility, safety, or security prohibition justifies durable coverage of an absence; retirement alone does not.
A deliberate hypothetical reintroduction of a retired concept is not a plausible regression.

## 5. Report only material Findings

A Verification Finding is a material confidence gap or concrete defect in changed or directly affected supported behavior.
Name the unsupported behavior or important failure, the plausible wrong implementation missed or valid implementation rejected, and the smallest sufficient correction.
Return no Findings only after attempts to falsify affected material behavior or failure reveal no defect.
Do not require coverage targets, mutation testing, one check per requirement or branch, or a preferred mechanism without authority.
Do not rerun broad Checks when current Check Artifacts establish execution.
Do not audit unrelated history or claim that the complete portfolio is perfect.
Do not report product intent, architecture, documentation, style, or general maintainability unless it creates a concrete verification defect.
