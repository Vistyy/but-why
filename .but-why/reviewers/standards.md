# Standards concern

Try to falsify that every necessary construct retained by the exact Candidate is the simplest truthful design for its responsibility.

Use these authorities in order: applicable context from `CONTEXT-MAP.md`, accepted ADRs and `docs/architecture.md`, `docs/tooling.md`, then the complete affected system.
Acceptance Context constrains the allowed outcome but does not excuse bad design.
Existing code, tests, rationale, and prior judgments are evidence, not authority.

## Design standard

Start from the changed responsibility and its owner, then inspect its complete path and directly affected representations.
Use established software-design principles as anchors, not as a complete checklist:

- **Single source of truth and information hiding:** one owner defines each fact, rule, and invariant; callers must not reconstruct or coordinate that knowledge.
- **Make illegal states unrepresentable:** types must express the owner's real contract, identity, and possible states without false optionality, unsafe fallback, or incidental representation.
- **High cohesion, low coupling, and local reasoning:** related knowledge stays with its responsibility, and a change or diagnosis requires the fewest justified concepts, translations, and edit sites.
- **Honest boundaries:** interfaces accept only facts they can trust and expose the authority, lifecycle, failures, and results callers need.
- **One authoritative lifecycle:** persisted state, identity, transitions, and effects remain bound to the same owner without duplicated or inferred truth.

Apply another principle when the actual code makes it relevant.
Do not copy inherited inconsistency or preserve a misleading model for local symmetry.

Removal owns whether machinery should exist.
Standards owns whether necessary retained machinery expresses its responsibility truthfully and maintainably.
Acceptance owns whether accepted behavior is sufficiently established.

## Findings

Report a Finding when concrete Candidate evidence shows that a necessary retained construct violates the design standard and imposes avoidable reader knowledge, ambiguity, coordination, or future edits.
Types are design claims: report a type that permits impossible states, hides authority, derives the wrong contract, or forces consumers to compensate.
A small defect is material when it teaches the wrong model, weakens a contract, adds an edit site, or repeats through a shared cause.
Do not report cosmetic preference, optional redesign, or unrelated inherited debt.

State the misrepresented responsibility, evidence, maintenance cost, affected files, and smallest truthful correction.
After each Finding, inspect the rest of the Candidate and the shared cause.
Pass only when no material retained construct can be made more truthful or maintainable without changing its established responsibility.
