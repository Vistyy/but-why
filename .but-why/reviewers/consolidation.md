# Consolidation concern

Try to falsify that the exact Candidate leaves each affected responsibility with one authoritative source of shared knowledge and no avoidable repeated work or coordinated edit sites.

Use these authorities in order: applicable context from `CONTEXT-MAP.md`, accepted ADRs and `docs/architecture.md`, `VERIFICATION.md`, `docs/tooling.md`, then the complete affected system.
Acceptance Context constrains what consolidation must preserve.
Existing code, tests, passing Checks, rationale, and prior judgments are evidence, not authority.

## Consolidation standard

Use these established principles as attack paths, not as a complete checklist:

- **DRY and single source of truth:** one truthful owner defines knowledge that consumers would otherwise reconstruct or keep synchronized.
- **Semantic duplication, shotgun surgery, and common closure:** find different-looking constructs that encode the same decision or must change together for the same reason.
- **N+1 work, loop-invariant work, batching, and amortization:** find repeated processes, I/O, external calls, setup, serialization, parsing, and translation when one execution can preserve all distinct results.
- **Economical verification and the test pyramid:** retain each expensive verification seam only for a material boundary fact that cheaper owner-level evidence cannot establish.
- **Essential versus accidental repetition:** preserve distinct policy, authority, lifecycle, result, parser, failure handling, and material boundary evidence while consolidating incidental mechanics around them.
- **Wrong abstraction and coincidental duplication:** prefer small owner-local repetition when sharing would couple different reasons to change, hide distinctions, or cost at least as much as direct code.

Apply every other consolidation path exposed by the actual Candidate across production code, persistence, configuration, workflow paths, Adapters, CLI presentation, documentation, and verification.
Similarity and call-site count are investigation triggers, not proof of one responsibility.
Judge parallel constructs together and require each retained representation, execution, and edit site to contribute a distinct present obligation after the others are retained.

Removal owns whether a responsibility should exist.
Consolidation owns whether necessary responsibilities repeat shared knowledge, mechanics, execution, representation, or edit obligations.
Standards owns whether retained structure truthfully models its responsibility.
Acceptance owns evidence sufficiency.

## Findings

Report a Finding only when concrete Candidate evidence establishes avoidable repetition and a smaller consolidation that preserves every distinct obligation.
State the shared responsibility, repeated constructs or executions, genuine distinctions that survive, and narrowest truthful owner.
Do not report cosmetic similarity, unrelated inherited debt, optional reuse, or sharing between independently changing owners.
After each Finding, inspect the complete Candidate and the shared cause.
Pass only when every material parallel construct in the affected system either earns separate retention through a distinct obligation or is consolidated.
