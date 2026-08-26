# System simplification plan

## Status and purpose

This is a working planning artifact for the investigation into reducing But Why's existing implementation complexity before further feature work.
It records established goals, evidence, provisional candidates, investigation coverage, and unresolved decisions so the discussion does not turn provisional mechanisms into accepted architecture.
It does not authorize implementation, change current architecture authority, or define supported product behavior.
Replace its implementation-ready outcomes with approved Tasks, and remove obsolete planning material when the initiative is complete.

## Required outcome

Make the existing system as small and simple as possible while preserving its accepted behavior, authority, safety, durability, recovery, and evidence requirements.
Do not optimize file size, function length, module count, or visual uniformity independently.
Minimize total concepts, caller knowledge, coordination, duplicated representation, verification setup, and pass-through code across each complete operation.

A proposed simplification is better only when the complete participating path becomes simpler without distributing required knowledge or weakening an established contract.
Different paths may retain different local structures when their ownership, lifecycle, transaction, external-effect, or verification requirements differ.

## Governing constraints

Keep the current Task Intent, Change Delivery, Repository Runtime, and Task/Change coordination ownership split.
Rethink the layering inside and between those owners from first principles rather than preserving current use-case, loader, port, Adapter, service, or Layer shapes.
The investigation must preserve other accepted decisions unless evidence establishes that changing one is necessary and the applicable authority accepts that change.
External execution must remain outside SQLite transactions.
Atomic persisted invariants must remain enforceable at the owning transaction boundary.
Task/Change coordination must continue to own operations that cross Task and Change state.
Agent Session execution must continue to own shared dispatch, continuation, transcript, Invocation settlement, and token evidence mechanics.
The investigation must distinguish required domain complexity from accidental implementation complexity.

## Investigation method

1. Census the production workflows, composition modules, persistence ports and Adapters, shared runtime capabilities, and input or response boundaries.
2. Trace one complete representative operation for every materially different ownership, lifecycle, transaction, external-effect, and verification pattern.
3. Record what each participating module owns, what its callers must know, and which knowledge it removes from adjacent callers.
4. Identify duplicated decisions, representations, transformations, orchestration, and verification setup.
5. Apply the deletion test to each seam and to the complete module chain.
6. Develop independent credible designs only after the material evidence areas are covered.
7. Include a ground-up minimum-seam design that is not constrained to preserve the current use-case, composition, persistence-port, or Effect Layer shapes.
8. Compare each design across every identified pattern instead of extrapolating from one path.
9. Convert the accepted design into independently assessable Tasks that each name the complexity removed, the behavior retained, and the verification boundary.
10. After the design is established, select the cheapest reliable prevention mechanism for each recurring mistake.

## Coverage map

The coverage map is a complete list of the currently identified evidence areas, not a claim that the evidence inside each area is complete.
Add an area when investigation discovers a materially different pattern.

| Area | Current status | Question |
| --- | --- | --- |
| Architecture, contexts, ADRs, and contributor guidance | Inspected initially | Which current rules are correct, insufficient, contradicted, or unenforced? |
| Ordinary Task creation, reads, edits, dependencies, and revision | Representative paths inspected | Do simple Task operations carry unnecessary workflow or persistence structure? |
| Task Review submission, inspection, and recovery | Representative paths inspected | Which orchestration, admission, settlement, projection, and persistence seams are necessary? |
| Task/Change linked Start, cancellation, completion, and joined inspection | Representative paths inspected | Where does cross-owner atomicity justify coordination, and where is coordination only forwarding? |
| Change Start, preparation, and Interactive Session launch | Representative paths inspected | Do these lifecycle operations share a justified interface or only a composition location? |
| Change Submit and Candidate capture | Representative paths inspected | Which ordering and provenance responsibilities are essential, duplicated, or split between callers? |
| Candidate Validation and the fixed Validation Gate | Representative paths inspected | Which services, Layers, ports, and phase representations reduce knowledge, and which add wiring? |
| Candidate Publication and reconciliation | Representative paths inspected | Where are external observation, uncertain mutation, and persisted evidence coordinated more than once? |
| Terminal Cleanup and Artifact lifecycle | Representative paths inspected | Which cleanup abstractions preserve one lifecycle, and which repeat resource coordination? |
| Agent Session execution and persistence | Representative paths inspected | Is its shared mechanism deep enough, and do owner callbacks expose the smallest truthful seam? |
| SQLite row and persisted JSON handling | Inspected initially | Which operations are syntax parsing, structural validation, domain reconstitution, invariant checking, or mapping? |
| Repo and Global Config boundaries | Inspected initially | Which parsing and diagnostic mechanics are duplicated without distinct policy? |
| GitHub, Herdr, and Pi response boundaries | Inspected initially | Which protocol mechanics are genuinely shared, and which transport or failure policies must remain separate? |
| CLI and file text boundaries | Inspected initially | Which UTF-8, size, BOM, and error semantics can be shared without combining owners? |
| CLI composition and test replacement seams | Representative paths inspected | Which callback loaders and injected use-case objects remove knowledge, and which only forward? |
| Verification architecture | Representative paths inspected | Which current test setup cost is required by real transactions or protocols, and which follows from broad seams? |

## Established decisions

The current domain ownership split remains the target structure.
Task Intent, Change Delivery, Repository Runtime, and Task/Change coordination represent materially different authority and lifecycle responsibilities.
The simplification initiative will use an operation-first application structure with selective owner-private state kernels.
A supported caller invokes one complete operation.
Persisted-state mechanics remain private to their owner, and an operation may use owner-local transaction functions directly.
Extract a cohesive private state kernel only when it owns substantial shared durable meaning, atomic transitions, reconstitution, or recovery interpretation.
Do not create a kernel merely for uniformity, replacement, mocking, or reusable SQL syntax.
A second path that interprets or changes the same durable rule must reuse its existing owner or establish materially different semantics.
Retain interfaces for genuine external variation, shared resource lifecycle, and accepted cross-owner coordination.

The completed architecture will make this layering understandable and select the cheapest reliable safeguards against recreating unnecessary layers.

## Established findings

The persistence and use-case size problems overlap but do not have one demonstrated root cause.
Persistence size is driven substantially by atomic lifecycle enforcement and reconstruction of authority distributed across persisted records.
Workflow size is driven substantially by orchestration of external effects that cannot occur inside SQLite transactions.
Boundary transformation and persisted-state reconstitution contribute duplication and obscure responsibilities, but they are not sufficient explanations for workflow complexity.

The current architecture correctly localizes many rules with their domain owner, but correct ownership has not been sufficient to keep the owner's internal structure small.
The phrase `decode` is currently used for materially different operations, including syntax parsing, structural validation, row mapping, domain reconstitution, normalization, and invariant checking.
No evidence currently supports one generic decoder or codec layer across all boundaries.

The representative paths converge on preserving explicit workflow owners, owner-defined external Adapters, transaction-owned atomic mutations, and dedicated Task/Change coordination.
They do not converge on one sequencing shape.
Change Start durably records before recoverable Git effects, Reconciliation observes remote evidence before atomic completion, Terminal Cleanup is an ordered retryable destructive saga, Candidate Publication records a pending mutation before uncertain GitHub effects, and Interactive Session launch relies on host-owned observation.
These differences are required behavior rather than inconsistency to normalize away.

The representative paths also converge on avoidable broadness around those justified cores.
Examples include pass-through use-case collections, composition loaders that repeat owner decisions, ports that expose operations unused by their callers, alternate mutation paths that omit required coordination checks, duplicate application operations with identical implementations, internal Effect service topology with no independent consumer, and production flexibility exercised only by tests.

Task Review currently duplicates reusable-judgment and advice decisions between composition and workflow.
Its production admission uses Task/Change coordination, while an optional workflow fallback permits a Task-only admission path.
Ordinary Task use cases similarly expose direct dependency and revision mutations while the supported CLI route requires Task/Change coordination.
These alternate seams permit callers to omit a supported-path precondition even though current production composition selects the correct route.

Candidate Validation exposes separate linked and unlinked validation methods with identical implementations even though persisted authority selects the applicable phases.
Its internal Layer topology exposes several construction-only services and requires tests to reproduce the same topology.
Candidate capture supports branch selection, reflog rename discovery, rebinding, caller-selected bases, and remote-default discovery even though the only identified production caller supplies an exact Change, worktree, and fetched base.
The supported status of that flexibility remains unresolved.

Mutation paths repeatedly reconstruct inspection-sized persisted graphs.
The established persisted-state contract does not require complete aggregate reconstruction on every read or mutation.
Direct modification of Shared Repository State is unsupported, owner writes validate local inputs inside transactions, lifecycle completion validates terminal coherence, and authority-selection reads revalidate the evidence they consume.
Compact projections validate only their selected facts, while inspection does not currently promise a global integrity audit.
Crashes can leave supported active or recovery states, so full terminal coherence after every mutation would conflict with intentional partial lifecycle state.
Operation-specific malformed-state tests may still establish exact defensive behavior that must be evaluated before removing a read-time check.

Composition boundaries generally own real concrete Adapter and lifecycle selection, but many callback shapes, projections, aliases, and test-only injection fields around them are forwarding conveniences.
Deleting composition responsibility would distribute repository, database, Git, GitHub, Agent, and coordination knowledge into CLI commands.
Deleting a callback loader or broad use-case object may still be valid when a direct operation can retain the same composition owner.
Candidate Validation itself owns a substantial reusable lifecycle, while the necessity of its construction-only internal service tags and Layer topology remains disputed and must be resolved by design comparison.

These observations establish candidate removals, not an accepted replacement architecture.

Existing Task `BY-54`, "Centralize SQLite Agent Invocation record decoding," appears superseded by completed Task `BY-63` and the current shared `sqliteAgentInvocation` implementation.
No Task mutation is authorized by this plan.

## Provisional candidates

Treat every item in this section as unaccepted unless `Established decisions` now accepts its governing principle.

### Operation-shaped application boundaries

Expose one application operation to a caller when the caller uses one operation and a loaded use-case object only forwards or aggregates unrelated capabilities.
Task Review submission, inspection, listing, and abandonment are the first candidate application operations.
Do not generalize this shape until ordinary Task, Change lifecycle, validation, publication, cleanup, and coordination paths have been compared.

### One coordinated workflow for essential sequencing

Keep externally meaningful sequencing in one owning workflow when splitting it would force callers to coordinate order, recovery, or authority.
Task Review submission is the first candidate because reuse, admission, external execution, restoration, cleanup, and atomic settlement form one supported operation.
The candidate does not imply that every stage belongs in one file or one dependency bag.

### Owner-local persisted-state reconstitution

Keep syntax parsing, structural validation, persisted-state reconstitution, domain invariant checking, and external-to-domain mapping distinguishable in names and ownership.
Share a mechanism only when current consumers demonstrably share its accepted inputs, semantics, failure policy, and lifecycle.
Do not introduce a repository-wide codec abstraction merely to make boundary code look uniform.

### Required coordination ports

Make a cross-owner port required when every supported execution must pass through that owner.
Task Review admission, linked-Task dependency edits, Task Revision, linked Change Start, cancellation, and exact merged completion support this candidate because their preconditions cross Task and Change state.
Remove fallback paths that bypass the required owner unless a current supported route requires them.

### Supported-operation inputs

Accept only inputs and variation that a current supported operation treats as authoritative or verifies against an authoritative source.
Remove production flexibility used only by direct tests or historical implementation paths.
Candidate capture is the first material test of this candidate because its production caller supplies exact Change, worktree, and fetched-base facts while the operation can also discover or rebind them.

### Mutation projections and inspection reconstruction

Let a mutation read and return only the facts needed to enforce and interpret that operation when complete graph reconstruction adds no distinct protection.
Validate owner writes locally and atomically, replay complete coherence at lifecycle completion and authority selection, and decode the representation and relationships consumed by each later read.
Keep complete reconstitution in inspection, history, or evidence-validation operations that require it.
Do not preserve a raw-SQL corruption check merely as a proxy for a global integrity guarantee that the product does not provide.
Do not remove an operation-specific malformed-state rejection until its supported behavior and distinct protection are established.

### Direct construction of private implementation dependencies

Construct implementation-only dependencies directly when internal Effect service tags and Layer topology have no independent production consumer, lifecycle, or replacement need.
Candidate Validation is the first candidate because its construction exposes several internal tags that only assemble one public service and tests reproduce the topology.
Retain Effect services and Layers where they own resources, authority, reusable sequencing, or a supported replacement boundary.

## Design comparison requirement

The design comparison must include an operation-focused refinement of the current owner boundaries and an independently developed ground-up minimum-seam design.
The ground-up design may delete or merge current use-case objects, composition loaders, persistence ports, Adapters, services, Layers, or module divisions when their removal does not distribute required knowledge or violate an accepted ownership constraint.
The comparison must identify the irreducible boundaries established by domain ownership, external-effect ordering, atomic transactions, uncertain mutations, lifecycle recovery, or supported replacement needs.
It must not preserve a seam merely because the current architecture names it, and it must not collapse a seam merely to reduce layers or line count.

## Independent design comparison

Three independent ground-up designs converged on an operation-first application structure over owner-local persisted-state mechanics.
A supported CLI route would call one complete operation, the operation would privately obtain Repository Runtime and concrete external capabilities, and Task/Change coordination would own any transaction crossing the two domain owners.
Fixed SQLite queries, projections, and atomic transitions would be private implementation mechanics rather than public variation ports.
Interfaces would remain for genuine external variation or lifecycle ownership, including Git, GitHub, agent processes, Herdr, command and filesystem execution, workspace lifecycles, and Repository Runtime resource management.

The designs differed mainly in how much private persistence structure to retain.
The minimum-seam variant lets each operation call owner-local transaction functions directly.
The more structured variant introduces a private owner state kernel for shared projections and atomic transitions, but risks recreating broad persistence ports under a different name.
The accepted target is an operation-first public structure that introduces a private state kernel only where it concentrates substantial shared transaction or reconstitution knowledge.

This candidate is materially different from splitting use-case files into smaller functions.
It would delete broad use-case factories, callback loaders, fixed-storage ports and Adapters, duplicate operation aliases, construction-only service topology, broad CLI injection objects, and oversized test fixtures when no supported variation or lifecycle requires them.
It would retain the distinct external-effect workflows and recovery state machines whose sequencing is accepted behavior.

A bounded design prototype is still required to establish whether Agent Session can replace generic raw-SQL settlement callbacks with owner-semantic journals while preserving atomic invocation and domain settlement.
The comparison also remains blocked on the supported status of Candidate discovery and rebinding, exact operation-specific malformed-state behavior, terminal inspection coherence, and any present requirement for replaceable persisted-state implementations.

## Rejected conclusions

The investigation has not accepted splitting large files as a simplification by itself.
The investigation has not accepted one architecture shape for every workflow.
The investigation has not accepted a generic repository-wide decoder, codec, repository, gateway, service, or use-case framework.
The investigation has not accepted moving external execution into persistence or moving atomic persisted invariants into callers.
The investigation has not accepted Task Review as sufficient evidence for a repository-wide redesign.

## Unresolved decisions

The investigation must determine the exact narrow state kernels justified by shared durable meaning and which existing broad persistence ports can be deleted in favor of direct owner-local transaction functions.
The investigation must determine which persisted-state reconstruction is duplicated mechanics and which is distinct projection or lifecycle policy.
The investigation must determine whether Effect services and Layers currently remove lifecycle knowledge or mainly add composition and verification setup.
The investigation must determine which current layering guidance is wrong, merely incomplete, or already correct but insufficiently enforced.
The investigation must determine whether exact Candidate capture should replace currently unsupported discovery and rebinding flexibility.
The investigation must determine which operation-specific persisted-corruption tests establish supported defensive behavior beyond the narrower global contract.
The investigation must determine whether terminal inspection should re-prove complete evidence coherence or continue to validate only its requested projections.
The investigation must determine whether Agent Session atomic domain links can hide `SqlClient` without adding a generic transaction-participant abstraction.
The investigation must determine the exact vocabulary for parsing, validation, reconstitution, mapping, normalization, and invariant checking only after their ownership is clear.
The investigation must determine the minimal set of architecture guidance, skill guidance, reviewer checks, structural checks, and behavior tests that prevents recurrence without adding redundant governance.

## Prevention selection

Use `docs/architecture.md` as the operative authority for the operation-first structure, selective kernel threshold, privacy boundaries, and second-path ratchet.
Record the consequential replacement of mandatory port and Adapter layering in a new ADR that explains the alternatives, evidence, and trade-offs without becoming the ordinary contributor instruction.
Expand the `AGENTS.md` loading condition so contributors read `docs/architecture.md` before adding or changing an application operation, persisted-state transition, persistence abstraction, or transaction boundary.
Do not repeat the complete architecture rule in `AGENTS.md`.

Give each existing Specialist only its concern-specific enforcement responsibility.
Removal challenges whether a new or retained kernel has a present responsibility.
Consolidation challenges repeated durable meaning across direct operations and recovery paths.
Standards challenges whether a retained kernel is cohesive, private, semantic, and narrower than owner-wide persistence.
All three use `docs/architecture.md` as authority rather than defining separate versions of the rule.
Do not require the Task Reviewer to choose an implementation mechanism unless the proposal itself makes an architecture decision necessary for readiness.
Do not create a project-specific skill for this rule.
Consider a skill only if later evidence establishes a substantial repeatable investigation procedure beyond loading the architecture authority.

Use a structural check only when an invalid dependency or visibility form can be identified mechanically with low false-positive and maintenance cost.
Use a behavior test when the protected fact is an observable supported contract.
Prefer real SQLite at operation and state-kernel verification boundaries rather than turning a private kernel into a mockable replacement port.
Do not encode one rule in several mechanisms unless each mechanism protects a distinct failure.
