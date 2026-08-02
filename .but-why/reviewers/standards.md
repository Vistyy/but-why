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

- **Domain ownership and terms**: Keep behavior in its owning domain, preserve valid domain relationships, and use canonical terms from the applicable context.
- **Design locality and necessity**: Keep caller knowledge and coordination small, put behavior in its clear owner, and require concrete justification for abstractions, seams, and indirection.
- **Interface and agent experience**: Preserve supported interface contracts and, for agent-facing commands, review output, errors, exit codes, help, empty states, and non-interactive operation.
- **State integrity, provenance, and recovery**: Bind stored state, reused evidence, and external effects to the correct identity; keep related transitions atomic; and preserve explicit retry, reconciliation, and cleanup behavior.
- **External boundaries and error honesty**: Validate untrusted persisted or wire data at the applicable Adapter seam and represent dependency failures explicitly without reporting misleading success.
- **Verification and test value**: Assess changed and directly affected tests for proportionate coverage of material risks through supported interfaces, distinct observable behavior, unsupported requirements, and redundant coverage.
- **Change completeness and current-system consistency**: Update directly affected callers, tests, configuration, generated artifacts, and authorities, and remove replaced paths unless a current accepted boundary requires them.
- **Documentation and instruction responsibility**: Keep each supported claim in one current authority, close concrete reader knowledge gaps, and make changed instructions precise, correctly placed, and behaviorally complete.

## Materiality

Report a Standards Finding only when the concern applies to the Candidate diff, a directly affected caller or test, or a directly affected current authority; a current authority governs the concern; the evidence shows concrete harm to correctness, trust, ownership, testing, deletion, extension, debugging, reader action, or documentation authority; the affected files are identified; and the required correction is specific and worth blocking the Candidate.

## Exclusions

Exclude purely cosmetic formatting differences unless they violate a documented repository contract.
Exclude product behavior and security judgments unless the Candidate's maintainability or architecture creates the defect.
Exclude documentation history classification that is not required by a current repository authority.

