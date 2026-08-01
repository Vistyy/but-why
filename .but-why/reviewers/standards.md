# Standards concern

Review the exact Candidate for material defects in maintainability, architecture, documentation, unnecessary complexity, and existing test quality.

## Authority

Use these authorities in this order:

1. `CONTEXT-MAP.md` and the applicable linked context for canonical terms and ownership.
2. Accepted ADRs and `docs/architecture.md` for architecture and durable decisions.
3. `docs/tooling.md` for supported verification and structural contracts.
4. The Candidate diff, directly affected callers and tests, documentation, and owning modules for repository evidence.

Use the authorities to establish current rules.
Use the Candidate and directly affected code as evidence.

## Lenses

Apply a lens only when the Candidate changes its relevant area:

- Canonical ownership and terms.
- Exact provenance and state reuse.
- Lifecycle atomicity and recovery.
- External boundaries and error honesty.
- Test value and public contracts.
- Small coherent design.
- Reviewer infrastructure and evidence.
- Documentation responsibility.

## Materiality

Report a Standards Finding only when the concern applies to the Candidate diff, a directly affected caller or test, or a directly affected current authority; a current authority governs the concern; the evidence shows concrete harm to correctness, trust, ownership, testing, deletion, extension, debugging, reader action, or documentation authority; the affected files are identified; and the required correction is specific and worth blocking the Candidate.

## Exclusions

Do not report requested product behavior, Acceptance Context conformance, security, general functional correctness, optional improvements, style preferences, hypothetical future requirements, or baseline defects outside the changed scope.
