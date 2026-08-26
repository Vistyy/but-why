---
status: accepted
---

# Use operation-first application boundaries

Task Intent, Change Delivery, Repository Runtime, and Task/Change coordination remain separate owners.
A supported caller invokes one complete application operation rather than loading a broad use-case object or persistence capability.
The operation privately resolves Repository Runtime and its concrete external capabilities, while Task/Change coordination owns operations and transactions that cross Task and Change state.

Fixed SQLite queries, projections, row mapping, and atomic transitions are private implementation mechanics of the applicable owner or coordination operation.
They are not public variation ports, replaceable persistence interfaces, or caller-selected Adapters.
An operation may call owner-local transaction functions directly.
A private state kernel is justified only when it concentrates substantial shared durable meaning, atomic transitions, projection rules, or recovery interpretation.
A second path that interprets or changes the same durable rule must reuse its existing owner or establish materially different semantics.
No owner-wide state kernel is required for structural uniformity.

Interfaces remain where a current responsibility requires genuine external variation, shared resource lifecycle, or cross-owner coordination.
Concrete storage, coordination, delivery, and agent-execution mechanisms remain hidden from product operation contracts, but possible future alternatives do not justify provider interfaces before a supported need establishes their truthful shared contract.
External execution remains outside SQLite transactions, and the owning transaction boundary continues to enforce atomic persisted invariants.

Read operations load and validate the persisted representation and relationships in their requested projection rather than auditing unrelated history.
Related records are loaded in bounded batches when cardinality would otherwise produce N+1 work.
Mutations load and validate the facts required for their preconditions, result, and atomic invariants.

Agent Session execution continues to own dispatch, continuation, transcript, Invocation settlement, and token evidence mechanics.
Owner-specific semantic Agent Session journals compose shared Agent Session transaction mechanics with Task Review or Change Validation writes without exposing arbitrary SQL callbacks.

This decision replaces the mandatory use-case, persistence-port, Adapter, composition-loader, and internal service-Layer structure previously inherited from ADR 0006 and the persistence-layering consequence in ADR 0012.
It does not replace ADR 0012's Task/Change ownership or coordination decisions.

## Considered Options

- Retain mandatory use-case objects, owner persistence ports, concrete Adapters, and callback composition loaders for every operation.
- Let every operation contain all of its SQL and reconstruction logic directly.
- Require one private state kernel for every owner.
- Use complete operations with direct owner-local state mechanics by default and selective private state kernels only where shared durable meaning justifies them.

## Consequences

Simple operations have a short path from caller to Repository Runtime and owner-local state mechanics.
Complex workflows retain their distinct external-effect ordering, uncertain-mutation recovery, cleanup, and authority behavior without forcing simple operations through the same structure.
Broad use-case factories, fixed-storage ports and Adapters, callback loaders, duplicate aliases, construction-only Effect service topology, and test-only replacement seams have no architectural entitlement and should be deleted when their supported callers migrate.
Candidate Validation is constructed directly from its concrete dependencies while retaining Effect sequencing, Snapshot Workspace lifecycle, and external execution boundaries.
Candidate capture consumes and verifies the exact Change, Repository Branch, Managed Worktree, and freshly fetched Change Base selected by Change Submission rather than discovering or repairing identity.

Operation and private state behavior that depends on SQLite transactions is verified with real SQLite.
Private state kernels are not routinely replaced with fakes in operation tests.
Structural checks may enforce dependency and visibility rules, but contextual kernel eligibility and duplicated durable meaning remain review judgments.
Existing implementation that still uses the replaced layering is migration work rather than a compatibility requirement or a model for new code.
