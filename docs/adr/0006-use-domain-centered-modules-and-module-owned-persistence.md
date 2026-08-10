---
status: accepted
---

# Use domain-centered modules and module-owned persistence

But Why is a modular monolith organized around Task and Change behavior.
A Task owns requested intent, dependencies, and user-facing lifecycle.
A Change owns code lineage, Candidates, Validation Runs, Findings, publication, and delivery.
Each behavior module owns cohesive persistence ports and named operations required to preserve its invariants.

## Considered Options

- Organize the application through generic architectural layers and broad stores.
- Let CLI modules coordinate storage and cross-domain transactions.
- Use domain-centered modules with narrow ports and centrally composed adapters.

## Consequences

CLI modules select operations and translate results without constructing storage or coordinating persistence.
Task and Change composition select concrete Adapters and construct their owner workflows.
Repository Runtime composition resolves Local Repository identity and owns Shared Repository State creation, compatibility, migration, connection lifetime, and closure.
Repository Runtime composition provides the scoped database capability and does not return an Adapter registry or application container.
The private SQLite implementation owns SQL and transaction mechanics and may implement several cohesive owner-defined ports.
Domain workflows do not import concrete Adapters or composition modules.
Each workflow receives one cohesive port or operation set that it uses, rather than a broad persistence facade or temporary capability view.
Ports exist only where behavior varies, an external boundary requires one, or one owner must preserve an invariant atomically.
An operation that crosses Task and Change state belongs to the owner whose invariant requires the coordination.
Change owns named atomic operations that cross persisted concepts for Change Start, Candidate capture, validation authority, publication, and completion.
Task-backed and taskless Changes use the same Change-owned validation and delivery path.
