# Standards concern

Review the exact Candidate for material defects in maintainability, architecture, documentation, and unnecessary complexity.

## Authority

Use these authorities in this order:

1. `CONTEXT-MAP.md` and the applicable linked context for canonical terms and ownership.
2. Accepted ADRs and `docs/architecture.md` for architecture and durable decisions.
3. `docs/tooling.md` for supported verification and structural contracts.
4. The Candidate diff, directly affected callers, documentation, and owning modules for repository evidence.

Use the authorities to establish current rules.
Use the Candidate and directly affected code as evidence.

## Lenses

Apply a lens only when the Candidate changes its relevant area:

- **Domain ownership and terms**: Keep behavior in its owning domain, preserve valid domain relationships, and use canonical terms from the applicable context.
- **Design locality and necessity**: Keep caller knowledge and coordination small, put behavior in its clear owner, and require concrete justification for abstractions, seams, and indirection.
  When the Candidate changes relationships across modules, trace one representative affected operation through the complete module chain and judge aggregate coordination instead of reviewing each changed module in isolation.
  When a capability gains a current caller, operation, or phase, inspect whether its name, owner, inputs, and interface still describe its complete current responsibility.
  Require correction only when current consumers expose concrete harm, such as misleading domain translation, duplicated invariant enforcement, or coordination that must change across owners.
  Share only mechanics and invariants that current consumers demonstrably have in common, and preserve their distinct policy, lifecycle, results, and persistence.
  Treat possible future reuse, code similarity, scattered feature checks, repeated conditionals, pass-through wrappers, and new layers as investigation leads for split ownership or displaced complexity, not as defects by themselves.
  Apply the deletion test to a new or changed abstraction: require it to reduce concrete caller knowledge or coordination, or to preserve a named ownership or lifecycle boundary.
  Prefer a correction that removes concepts or moving parts over one that only redistributes complexity, but require evidence that the simpler structure preserves required behavior and repository authority.
- **Interface integrity**: Review changed interfaces and directly affected callers for added caller knowledge, ordering constraints, and optional capabilities.
  Require authoritative inputs, operation-local outcomes, enforced mutation preconditions, and only the operations each caller uses.
  Treat an unsafe test cast as evidence of a possible contract mismatch.
- **Agent experience**: Preserve supported agent-facing command contracts, including output, errors, exit codes, help, empty states, and non-interactive operation.
- **State integrity, provenance, and recovery**: Bind stored state, reused evidence, and external effects to the correct identity; keep related transitions atomic; and preserve explicit retry, reconciliation, and cleanup behavior.
- **External boundaries and error honesty**: Rely on contracts enforced by earlier runtime boundaries.
  At the applicable Adapter seam, validate only operation-required facts that its contract does not guarantee and decode only the persisted or wire observations selected for that operation.
  Do not inspect unrelated data for corruption.
  Represent dependency failures explicitly without reporting misleading success.
- **Change completeness and current-system consistency**: Update directly affected callers, configuration, generated artifacts, and authorities, and remove replaced paths unless a current accepted boundary requires them.
- **Documentation and instruction responsibility**: Keep each supported claim in one current authority, close concrete reader knowledge gaps, and make changed instructions precise, correctly placed, and behaviorally complete.

## Materiality

Report a Standards Finding only when the concern applies to the Candidate diff, a directly affected caller or test, or a directly affected current authority; a current authority governs the concern; the evidence shows concrete harm to correctness, trust, ownership, testing, deletion, extension, debugging, reader action, or documentation authority; the affected files are identified; and the required correction is specific and worth blocking the Candidate.

## Exclusions

Exclude purely cosmetic formatting differences unless they violate a documented repository contract.
Exclude product behavior and security judgments unless the Candidate's maintainability or architecture creates the defect.
Exclude judgments about the sufficiency, value, redundancy, staleness, or boundary fidelity of maintained verification evidence because the Verification Specialist owns them.
Test code remains in scope only when it creates a material architecture or maintainability defect independent of its evidentiary value.
Exclude documentation history classification that is not required by a current repository authority.

