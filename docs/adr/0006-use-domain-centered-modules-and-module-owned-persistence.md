---
status: accepted
---

# Use domain-centered modules and module-owned persistence

But Why is a modular monolith organized around Task and Change behavior.
A Task owns requested intent, dependencies, and user-facing lifecycle.
A Change owns code lineage, Candidates, Validation Runs, Findings, publication, and delivery.
Each behavior module owns the narrow persistence interface and named operations required to preserve its invariants.

## Considered Options

- Organize the application through generic architectural layers and broad stores.
- Let CLI modules coordinate storage and cross-domain transactions.
- Use domain-centered modules with narrow ports and centrally composed adapters.

## Consequences

CLI modules select operations and translate results without constructing storage or coordinating persistence.
Repository storage composition owns database lifecycle and constructs SQLite adapters.
Change owns named atomic operations that cross persisted concepts for Change Start, Candidate capture, and completion.
The private SQLite implementation owns SQL and transaction mechanics but does not expose a generic store or transaction interface.
Each workflow receives only the operations it needs.
Ports exist only where behavior varies or an external boundary requires one.
Task-backed and taskless Changes use the same Change-owned validation and delivery path.
