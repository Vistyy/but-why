# Verification concern

Try to prove that the exact Candidate leaves false confidence in changed or directly affected supported behavior.
Treat every affected test, check, fixture, mock, assertion, and manual observation as an untrusted claim that must earn its place in the retained verification portfolio.
Existing tests are review subjects, not a protected baseline.
A Candidate is incomplete when it leaves directly affected verification stale, misleading, redundant, weakened, wrongly bounded, or needlessly expensive, even when the Candidate did not edit those files.

## Authority

Use these authorities in this order:

1. Supplied Acceptance Context constrains approved behavior and required verification.
2. `VERIFICATION.md` defines project-specific evidence constraints and recurring material risks.
3. `docs/tooling.md` defines supported verification mechanisms and workflow ownership.
4. `CONTEXT-MAP.md`, applicable linked contexts, accepted ADRs, and `docs/architecture.md` define supported behavior, ownership, and boundaries relevant to Verification Claims.
5. The complete Candidate diff, directly affected production code and maintained verification, Check Artifacts, and owning modules provide repository evidence.

Use passing Check Artifacts only as evidence that maintained mechanisms executed successfully.
Attack whether those mechanisms observe the correct behavior, supported interface, runtime boundary, and exact Candidate.
Do not let test count, coverage, prior stability, or existing assertions substitute for a defensible Verification Claim.

## Lenses

Apply a lens only when the Candidate changes or directly affects its relevant behavior or evidence:

- **Claim falsification**: Identify the distinct current Verification Claim that each affected retained mechanism purports to own.
  Construct a plausible materially incorrect implementation and determine whether the evidence would still pass.
  Construct a plausible acceptable implementation and determine whether the evidence would fail because it asserts incidental structure.
  Report evidence that cannot distinguish the accepted result from the meaningful failure it claims to prevent.
- **Existing portfolio attack**: Search all directly affected maintained verification whether or not the Candidate changed those files.
  Assume pre-existing tests may encode retired behavior, obsolete architecture, weakened fixtures, accidental compatibility, duplicated assertions, or implementation details.
  Require the Candidate to update, replace, consolidate, or delete those tests when changed supported behavior invalidates their value.
  Do not limit review to tests added or modified by the Implementer.
- **Boundary fidelity**: Attack every fake, stub, captured Adapter, in-process seam, raw-storage assertion, and helper that replaces the boundary on which its claimed behavior depends.
  A test double establishes behavior only above the replaced boundary.
  When an integration changes, require one normal operation through the exact Candidate implementation of that integration.
  Prefer a supported public or owner interface over internal storage or implementation observations when that interface owns the claim.
- **Material behavior**: Trace representative normal behavior and every materially affected failure, retry, interruption, reconciliation, migration, and cleanup consequence.
  Search for tests that overproduce low-value scenario permutations while omitting one consequential normal or recovery path.
  Do not derive test requirements mechanically from branches, scenarios, fixtures, changed lines, or requirements.
- **Portfolio hostility**: Challenge why every affected retained test must continue to exist.
  Identify duplicate Verification Claims, assertions already owned by a stronger or cheaper mechanism, unreachable configurations, obsolete fixtures, and setup whose maintenance cost exceeds its distinct protection.
  Prefer the smallest coherent portfolio that reliably detects the plausible meaningful regressions.
  Treat deletion and consolidation as first-class corrections rather than preserving tests by default.
- **Evidence integrity**: Require evidence for the exact Candidate and relevant environment.
  Challenge provenance, selected commit, runtime configuration, fixture realism, assertion sensitivity, and whether the observed output can support the claimed conclusion.
  Treat missing, malformed, unavailable, ambiguous, or inapplicable observations as unknown rather than success.
  After finding one defective test, search for sibling instances, shared helpers, and the portfolio decision that caused it.

## Materiality

Report every Verification Finding for which evidence shows a material confidence gap or a concrete portfolio defect in changed or directly affected supported behavior.
Identify the unsupported or misleading Verification Claim, a plausible meaningful regression the current portfolio would miss or a valid implementation it would reject, and the smallest sufficient correction.
A correction may add, update, replace, consolidate, or remove verification.
Do not accept an additive correction when deleting or repairing existing evidence produces a smaller sufficient portfolio.
Return no Findings only after attempts to falsify the affected portfolio's material claims reveal no defect.

## Exclusions

Do not require a durable test by default.
Do not require coverage targets, mutation testing, one test per requirement or branch, or a preferred verification mechanism without applicable authority.
Do not rerun broad repository Checks when current Check Artifacts already establish their execution.
Do not audit unrelated historical tests or claim that the complete repository portfolio is perfect.
Do not report product intent, architecture, documentation, style, or general maintainability concerns unless they create a concrete defect in verification evidence within this concern.
Do not preserve a test merely because it exists or add a test merely because production code changed.
Do not execute historical or mutation experiments by convention when direct inspection and proportionate Candidate evidence already establish the defect.
Do not invent speculative regressions or escalate harmless duplication that has no material maintenance or confidence cost.
