# System simplification plan

## Status and purpose

Status: Active investigation authorized by the Operator.

This is a working planning artifact for the investigation into reducing But Why's existing implementation complexity before further feature work.
It records established goals, evidence, accepted architecture decisions, investigation coverage, and remaining Task-shaping work.
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
| Repository initialization, migration, identity, and scoped SQLite resource lifecycle | Representative paths inspected | Which Repository Runtime Layers and transaction capabilities own real resources and must remain? |
| Ordinary Task creation, reads, edits, dependencies, and revision | Representative paths inspected | Do simple Task operations carry unnecessary workflow or persistence structure? |
| Standalone and linked Task cancellation | Representative paths inspected | Which Task mutation is owner-local, and which preconditions and completion writes require Task/Change coordination? |
| Task Review submission, inspection, and recovery | Representative paths inspected | Which orchestration, admission, settlement, projection, and persistence seams are necessary? |
| Task/Change linked Start, cancellation, completion, and joined inspection | Representative paths inspected | Where does cross-owner atomicity justify coordination, and where is coordination only forwarding? |
| Change Start, preparation, and Interactive Session launch | Representative paths inspected | Do these lifecycle operations share a justified interface or only a composition location? |
| Change authority Decisions and Blockers | Representative paths inspected | Which locks and authority rules must remain, and which read or mutation ports only forward fixed SQLite mechanics? |
| Change list, detail, Findings, and Validation history projections | Representative paths inspected | Which complete read operations need coordinated projections, requested-record validation, and bounded batching? |
| Change Submit and Candidate capture | Representative paths inspected | Which ordering and provenance responsibilities are essential, duplicated, or split between callers? |
| Candidate Validation and the fixed Validation Gate | Representative paths inspected | Which services, Layers, ports, and phase representations reduce knowledge, and which add wiring? |
| Validation Run inspection, Artifact content, and abandonment | Representative paths inspected | Which reads and cleanup sequencing are complete operations, and which fixed-storage ports or loaders can disappear? |
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
Replaceable storage, coordination, delivery, and agent execution are product-direction possibilities rather than requirements for interchangeable implementations today.
Keep each current mechanism and incidental representation private to its owner, but introduce a provider interface or configurable capability only when a concrete supported alternative establishes a truthful shared contract.
Candidate capture will consume the submission-selected Change identity, open state, canonical Git Common Directory, recorded Managed Worktree path, Repository Branch ref, Change Base ref, and freshly fetched Change Base commit.
It will verify that the observed workspace has the recorded canonical path, Git Common Directory, and Repository Branch; that the workspace is clean with a committed head; that the refreshed base ref still equals the recorded Change Base; and that the exact refreshed commit is an ancestor of the head.
Its atomic write will recheck the Change remains Open with the same durable repository, worktree, branch, and base identity before recording or reusing the Candidate identified by the exact base and head commits.
It will not discover a Change by branch, inspect reflog renames, rebind a Change, or select or locally resolve a base.
If branch repair becomes supported later, it must be an explicit recovery operation with its own authority and observable result.
Each read operation will validate the persisted representation and relationships in its requested projection rather than reconstructing or auditing all related history.
Mutations will validate the facts needed for their preconditions and atomic invariants, and terminal operations will validate the exact evidence needed for completion.
An unrelated malformed historical record will not invalidate an operation that does not consume it.
Candidate Validation will be constructed directly as one operation from its concrete dependencies.
Remove its construction-only internal Effect service tags and Layer graph, and replace the identical `validateCandidate` and `validateAcceptanceContextCandidate` methods with one validation operation.
Retain Effect for sequencing and typed errors, retain Snapshot Workspace and external execution boundaries, and retain Layers where they manage a real resource or independently consumed capability.
Use `parse` for text syntax, `decode` for validating unknown representation into a typed value, `encode` for producing a stored or transmitted representation, `map` for a pure transformation between known shapes, `read`, `load`, or `project` for querying and assembling an operation result, `normalize` for canonicalization, and `validate` for domain rules or relationships.
Do not establish `reconstitute` as standard vocabulary, and do not create generic codec objects merely to pair encoding and decoding.
Ordinary Task operations will directly open Repository Runtime and call private owner-local SQL functions rather than loading `TaskUseCases` through a broad `TaskPersistence` interface.
Remove `withTaskUseCases`, `openTaskUseCases`, the duplicate `getTaskForInspection` alias, broad CLI Task use-case injection objects, and direct revision or dependency mutation paths that bypass Task/Change coordination.
Retain complete operations for Task Context Draft filesystem sequencing, retain owner-private Task transaction functions for coordination, and verify supported operations against real SQLite.
Use this ordinary Task slice as the first implementation proof of the accepted architecture before migrating complex Change workflows.
Do not create an owner-wide Task or Change state kernel.
The Agent Session journals are the only state kernels currently established by direct evidence.
Validation Run, Candidate Publication, and Terminal Cleanup state are candidates because normal execution and recovery paths may share durable meaning, but each migration must prove that shared rules justify a cohesive lifecycle-sized kernel before introducing one.
Keep the applicable state mechanics direct when that proof is absent.
Retain one real-SQLite test for each distinct persisted boundary contract, but consolidate repeated decoder cases and avoid sending every malformed fixture through every consumer without a separate supported requirement.

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
That unsupported flexibility will be removed in favor of the accepted exact-capture contract.

Mutation paths repeatedly reconstruct inspection-sized persisted graphs.
The established persisted-state contract does not require complete aggregate reconstruction on every read or mutation.
Direct modification of Shared Repository State is unsupported, owner writes validate local inputs inside transactions, lifecycle completion validates terminal coherence, and authority-selection reads revalidate the evidence they consume.
Compact projections validate only their selected facts, while inspection does not currently promise a global integrity audit.
Crashes can leave supported active or recovery states, so full terminal coherence after every mutation would conflict with intentional partial lifecycle state.
Distinct operation-specific malformed-state tests remain necessary for the persisted representation and relationships consumed at each boundary, but repeated corruption fixtures do not establish a requirement for every consumer to reconstruct all related history.

Measured disposable-repository probes found both N+1 query growth and repeated reconstruction.
Task List grew from 8 `SELECT` statements for one Task to 58 for six Tasks with five linked Changes.
Validation Run history grew from 10 `SELECT` statements for one Candidate and Run to 27 for three Candidates and six Runs.
Task Review List grew from 8 `SELECT` statements for one Review to 20 for five Reviews.
Change Show with passing evidence performed 66 `SELECT` statements for one Change, and Validation Run Show performed 36 for one Run, primarily through repeated authority and coherence reconstruction rather than cardinality-driven N+1 behavior.
Change List remained constant at 3 `SELECT` statements, and no cardinality-driven N+1 pattern was found in the bounded Change Submit probes.
The accepted requested-projection rule does not by itself prevent N+1 behavior, so each retained projection must also batch related reads rather than query once per parent record.

Composition boundaries generally own real concrete Adapter and lifecycle selection, but many callback shapes, projections, aliases, and test-only injection fields around them are forwarding conveniences.
Deleting composition responsibility would distribute repository, database, Git, GitHub, Agent, and coordination knowledge into CLI commands.
Deleting a callback loader or broad use-case object may still be valid when a direct operation can retain the same composition owner.
Candidate Validation itself owns a substantial reusable lifecycle, while its construction-only internal service tags and Layer topology add wiring and verification setup without an independent consumer or resource lifecycle.

The boundary-mechanics audit did not support a generic JSON, Schema, protocol, command-result, or text-input abstraction.
Persisted-data failure wrapping, Agent Invocation row decoding, Pi JSONL record decoding, and CLI text input are already consolidated at truthful boundaries.
Repo and Global Config retain distinct schemas and missing-file policy, but their source-text JSON parsing is duplicated and can share one small configuration-owned mechanic.
The GitHub gateway duplicates the existing GitHub remote URL parser exactly, while push-destination parsing remains separate because it enforces different credential and destination rules.
Validation Evidence and Candidate Validation duplicate stored Findings array decoding and Artifact-reference validation, which belongs in one Change Validation-private mechanic before operation-specific projection enrichment.
Pi output traversals share records but intentionally apply different strict success, partial-failure, and recovery policies, so a shared scanner is not justified without measured material deletion.
Herdr command and socket decoding, Task Review and Validation JSON primitives, and repository-file readers retain different inputs, failure semantics, or lifecycle obligations.

These observations support the accepted operation-first architecture in ADR 0013.
Exact removals still require authorized Tasks that preserve each complete supported operation.

Existing Task `BY-54`, "Centralize SQLite Agent Invocation record decoding," appears superseded by completed Task `BY-63` and the current shared `sqliteAgentInvocation` implementation.
No Task mutation is authorized by this plan.

## Accepted design applications

The governing principles in this section are accepted.
Task authoring must still name the exact supported operation, retained obligations, and complete replacement boundary for each implementation increment.

### Operation-shaped application boundaries

Expose one application operation to a caller when the caller uses one operation and a loaded use-case object only forwards or aggregates unrelated capabilities.
Task Review submission, inspection, listing, and abandonment are distinct complete application operations.
The representative ordinary Task, Change lifecycle, validation, publication, cleanup, and coordination paths support this structure without requiring identical internal sequencing.

### One coordinated workflow for essential sequencing

Keep externally meaningful sequencing in one owning workflow when splitting it would force callers to coordinate order, recovery, or authority.
Task Review submission is the first candidate because reuse, admission, external execution, restoration, cleanup, and atomic settlement form one supported operation.
This rule does not imply that every stage belongs in one file or one dependency bag.

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
Candidate capture applies this rule because its production caller supplies exact Change, worktree, and fetched-base facts while the current operation can also discover or rebind them.

### Mutation projections and inspection reconstruction

Let a mutation read and return only the facts needed to enforce and interpret that operation when complete graph reconstruction adds no distinct protection.
Validate owner writes locally and atomically, replay complete coherence at lifecycle completion and authority selection, and decode the representation and relationships consumed by each later read.
Keep complete reconstitution in inspection, history, or evidence-validation operations that require it.
Do not preserve a raw-SQL corruption check merely as a proxy for a global integrity guarantee that the product does not provide.
Do not remove an operation-specific malformed-state rejection until its supported behavior and distinct protection are established.

### Direct construction of private implementation dependencies

Construct implementation-only dependencies directly when internal Effect service tags and Layer topology have no independent production consumer, lifecycle, or replacement need.
Candidate Validation applies this rule because its construction exposes several internal tags that only assemble one public operation and tests reproduce the topology.
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

A bounded disposable prototype established that owner-specific semantic Agent Session journals can replace generic raw-SQL callbacks without coupling Agent Session to Task or Change.
The prototype made each owner SQLite Adapter compose shared Agent Session transaction mechanics with its own linkage and settlement writes, while workflows supplied plain semantic journal entries rather than `SqlClient`, Effects, callbacks, or registered transaction participants.
Nine real-SQLite integration cases established atomic Task Review dispatch and settlement, Simplification Advice settlement, Change reviewer dispatch and Specialist settlement, rollback for invalid owner entries and relationships, rejection of a second unsettled Invocation without duplicate owner rows, and interrupted execution settlement as `return_unknown` with the owner tooling failure in the same journal.
Task Review, Simplification Advice, Acceptance Review, and Specialist Review compiled through the same `AgentSessionJournal<Entry>` contract, while Agent Session imported neither Task nor Change.
The interruption case exercised `executeAgentSession` with a fake interrupted runtime rather than OS process termination or transcript discovery, and the concurrency case used sequential immediate transactions rather than simultaneous connections.
Those are retained behavior-verification obligations, not evidence that a second journal contract is needed.
The focused implementation changed 19 files with 457 insertions and 472 deletions, so its value is removal of a leaky public concept and clearer transaction ownership rather than demonstrated line-count reduction.
The comparison no longer has an unresolved persisted-state reconstruction or Agent Session journal feasibility contract.

## Rejected conclusions

The investigation has not accepted splitting large files as a simplification by itself.
The investigation has not accepted one architecture shape for every workflow.
The investigation has not accepted a generic repository-wide decoder, codec, repository, gateway, service, or use-case framework.
The investigation has not accepted moving external execution into persistence or moving atomic persisted invariants into callers.
The investigation has not accepted Task Review as sufficient evidence for a repository-wide redesign.

## Recommended migration decomposition

The implementation should be authorized as independently assessable vertical migrations rather than one repository-wide rewrite.
Each migration removes its replaced supported path in the same Change and preserves real-SQLite evidence for its distinct transaction and persisted-state contracts.

1. Replace Agent Session raw-SQL callback links with owner-specific semantic journals for Task Review, Simplification Advice, Acceptance Review, and Specialist Review.
2. Replace ordinary and coordinated Task use-case loading with complete operations, including Task list and detail projections, Context Draft sequencing, dependencies, Revision, linked and standalone cancellation, and the supported coordination paths.
3. Replace Task Review use-case loading with complete submission, inspection, listing, advice, abandonment, and interruption-recovery operations that require coordinated admission and use the semantic journal.
4. Replace Candidate capture discovery and rebinding with the exact submission-selected capture contract.
5. Construct Candidate Validation directly and migrate validation execution, inspection, Artifact content, abandonment, and interruption recovery to complete operations, including one Change Validation-private stored Findings decoder and the semantic journal.
6. Replace Change read and authority port collections with complete list, detail, Finding, Validation history, Decision, and Blocker operations using requested projections and bounded related-record reads.
7. Replace Change Start, Prepare, and Implement loaders and broad injection seams with their distinct complete operations while retaining their different Git and Interactive Session lifecycles.
8. Replace Change Submit, Candidate Publication, and reconciliation composition seams with complete operations, reuse the exact Candidate capture operation, and reuse the existing GitHub remote parser instead of the duplicate gateway parser.
9. Replace terminal cleanup and remaining recovery loaders with complete operations, introducing a private state kernel only where the migration proves shared durable lifecycle meaning.
10. After the migrated paths exist, add only low-false-positive structural checks for the resulting dependency and visibility rules, and remove transitional architecture wording and obsolete test support seams.

The shared Config source-text parser belongs in the first migration that replaces Task Review or Change policy composition and must preserve distinct Repo Config, Global Config, and missing-file policy.
No migration is needed for Pi traversal, Herdr decoding, command results, or text readers unless new evidence establishes material deletion without merging their distinct policies.

Task Review interruption work `BY-58` and Validation Run interruption work `BY-72` define behavior that the journal, Task Review, and Candidate Validation migrations must preserve.
The recommended sequence completes those Tasks before migrations 1, 3, and 5 rather than implementing recovery twice across the old and replacement structures.
Test process work `BY-68` may continue independently, but test-support consolidation that overlaps its process lifecycle should wait for its merged result.

Migrations 3 and 5 depend on migration 1.
Migration 8 depends on migrations 4 and 5.
Migration 10 depends on the affected migration paths being complete.
Other dependencies should be added only when Task authoring establishes a real delivery or verification constraint rather than a preferred execution order.

## Remaining Task-shaping work

Allocate every current production loader, use-case object, persistence port, Adapter opener, construction-only service or Layer, and CLI injection seam to one migration above or one retained responsibility while authoring the Tasks.
Reconcile exact file overlap with the final merged results of `BY-58`, `BY-68`, and `BY-72`.
Ensure each migration removes its replaced supported path without leaving an indefinite dual architecture.
Do not change UTF-8, BOM, size, or missing-file behavior merely to consolidate readers.

## Prevention selection

Use `docs/architecture.md` as the operative authority for the operation-first structure, selective kernel threshold, privacy boundaries, and second-path ratchet.
ADR 0013 records the consequential replacement of mandatory port and Adapter layering, its alternatives, evidence, and trade-offs without becoming the ordinary contributor instruction.
`AGENTS.md` requires contributors to read `docs/architecture.md` before adding or changing an application operation, persisted-state transition, persistence abstraction, or transaction boundary.
Do not repeat the complete architecture rule in `AGENTS.md`.

Do not add state-kernel-specific instructions to the Specialist Reviewers.
Their existing deletion, single-source-of-truth, cohesion, information-hiding, and authority rules already expose violations, and each Reviewer already treats `docs/architecture.md` as authority.
Repeating this architecture decision in several prompts would overemphasize one mechanism and create competing versions of the rule.
Do not require the Task Reviewer to choose an implementation mechanism unless the proposal itself makes an architecture decision necessary for readiness.
Do not create a project-specific skill for this rule.
Consider a skill only if later evidence establishes a substantial repeatable investigation procedure beyond loading the architecture authority.

Use a structural check only when an invalid dependency or visibility form can be identified mechanically with low false-positive and maintenance cost.
Use a behavior test when the protected fact is an observable supported contract.
Prefer real SQLite at operation and state-kernel verification boundaries rather than turning a private kernel into a mockable replacement port.
Do not encode one rule in several mechanisms unless each mechanism protects a distinct failure.
