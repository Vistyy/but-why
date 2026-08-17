# Verification concern

Review the exact Candidate for material defects in verification evidence for changed or directly affected supported behavior.
Own the value, sufficiency, truthfulness, and maintenance cost of the affected retained verification portfolio.

## Authority

Use these authorities in this order:

1. Supplied Acceptance Context constrains approved behavior and required verification.
2. `VERIFICATION.md` defines project-specific evidence constraints and recurring material risks.
3. `docs/tooling.md` defines supported verification mechanisms and workflow ownership.
4. `CONTEXT-MAP.md`, applicable linked contexts, accepted ADRs, and `docs/architecture.md` define supported behavior, ownership, and boundaries relevant to verification claims.
5. The complete Candidate diff, directly affected production code and tests, Check Artifacts, and owning modules provide repository evidence.

Use passing Check Artifacts only as evidence that the maintained mechanisms executed successfully.
Do not treat passing Checks as evidence that those mechanisms observe the correct behavior or boundary.

## Lenses

Apply a lens only when the Candidate changes or directly affects its relevant behavior or evidence:

- **Verification Claims**: Determine the current distinct claim owned by each affected retained test or check.
  Require evidence that can distinguish the accepted result from a plausible material failure.
- **Boundary fidelity**: Require evidence through the supported interface and the runtime boundary on which the claim depends.
  A test double establishes behavior only above the replaced boundary.
  When an integration changes, require one normal operation through the exact Candidate implementation of that integration.
- **Material behavior**: Inspect representative normal behavior and materially affected failure, retry, interruption, reconciliation, migration, and cleanup behavior.
  Do not derive test requirements mechanically from branches, scenarios, fixtures, changed lines, or requirements.
- **Portfolio value**: Identify affected retained tests that are stale, weakened, redundant, coupled to implementation details, or no longer own a distinct current Verification Claim.
  Prefer updating, consolidating, or deleting retained evidence when the remaining portfolio preserves sufficient protection at lower maintenance cost.
- **Candidate completeness**: Inspect directly affected maintained verification even when the Candidate does not modify those test files.
  Judge the complete current verification state for affected behavior rather than only whether previous Findings were patched.
- **Evidence integrity**: Require evidence for the exact Candidate and relevant environment.
  Treat missing, malformed, unavailable, ambiguous, or inapplicable observations as unknown rather than success.

## Materiality

Report a Verification Finding only when evidence shows a material confidence gap or a concrete portfolio defect for changed or directly affected supported behavior.
Identify the unsupported or misleading Verification Claim, the plausible meaningful regression that current evidence would miss, and the smallest sufficient correction.
A correction may add, update, consolidate, replace, or remove verification.

## Exclusions

Do not require a durable test by default.
Do not require coverage targets, mutation testing, one test per requirement or branch, or a preferred verification mechanism without applicable authority.
Do not rerun broad repository Checks when current Check Artifacts already establish their execution.
Do not audit unrelated historical tests or claim that the complete repository portfolio is perfect.
Do not report product intent, architecture, documentation, style, or general maintainability concerns unless they create a concrete defect in verification evidence within this concern.
Do not preserve a test merely because it exists or add a test merely because production code changed.
