# Task Backend boundary plan

**Status:** Active exploration.
It is not implementation authority.

**Removal condition:** Remove this file after the Operator approves the supported outcome, its implementation Tasks are recorded, and any implemented architectural decision is recorded in its authoritative artifact.

## Outcome

Task Intent owns canonical Task meaning, dependencies, approval, and user-facing lifecycle without requiring callers to know the storage or service that supplies Task authority.
SQLite is the only Task Backend implemented for the first release.
The architecture keeps a credible path to a future authoritative Linear or GitHub Issues Adapter without introducing remote synchronization, offline behavior, or generic provider machinery now.

## Fixed domain behavior

A Task remains But Why's durable record of requested intent, dependencies, and user-facing progress.
Task Lifecycle, Task Dependency meaning, Task Submission authority, exact-proposal approval, Change Start eligibility, and completion from exact merged-Candidate evidence remain Task Intent and Change Delivery policy.
A backend cannot redefine these meanings while presenting its result as the same supported operation.

The CLI and any future application caller invoke domain-owned Task operations.
They do not invoke backend-native mutations directly.

## Current coupling

SQLite currently stores Tasks, Task Reviews, Changes, and their relationships in one Shared Repository State database.
This permits atomic operations that cross Task and Change state:

- Change Start verifies Task eligibility, captures Acceptance Context, and links the Change.
- Change cancellation can update the linked Task.
- Exact merged-Candidate completion closes the Change and completes the linked Task.

The existing `TaskPersistence` port does not by itself define a replaceable Task Backend because these operations bypass a standalone Task store boundary.

## First-release boundary

The first-release design must identify:

- Which Task facts are authoritative backend facts.
- Which local records are Change coordination, immutable acceptance evidence, or recovery state.
- Which domain operation owns each cross-boundary transition.
- What conditional mutation and reconciliation would replace local atomicity for a future remote backend.
- Which stable Task identity crosses into Change Delivery.
- What SQLite Adapter behavior implements the same domain operations in the first release.

The boundary should be expressed through cohesive domain operations rather than CRUD over Tasks.
The physical SQLite implementation may continue to use one transaction where the configured SQLite backend makes that guarantee available.
The domain contract must not falsely promise a distributed transaction to a future remote backend.

## Future remote authority

A future remote Task Backend may map canonical Task fields to backend-native concepts such as an issue title, description, dependency relationship, and status.
The Adapter would own that mapping.
But Why would perform fresh authoritative reads when required and would not promise offline operation unless a later requirement adds it.

A failed or uncertain remote mutation would require reconciliation before retry unless the backend documents the mutation as idempotent.
The exact reconciliation protocol is deferred until a remote backend is selected.

Losing local Shared Repository State may lose active Change coordination and rich execution evidence.
A remote Task Backend alone is not a complete remote-state or disaster-recovery solution.
The first release makes no broader durability claim.

## Exclusions

The first release does not include:

- A Linear Adapter.
- A GitHub Issues Adapter.
- Bidirectional synchronization.
- Offline queues or conflict resolution.
- Task Backend discovery or a plugin registry.
- Arbitrary backend-defined Task lifecycle meanings.
- A generic remote-state backend for Changes, Validation Runs, Agent Sessions, or publication recovery.

## Decisions still required

- Define the minimum canonical Task data required across every supported backend.
- Define the stable reference retained by a Change after Change Start.
- Decide which local Task representation, if any, remains when a future external backend is authoritative.
- Define the domain-level operations needed for Change Start, cancellation, and completion without assuming shared-database atomicity.
- Review the released SQLite schema only after these ownership decisions are accepted.

## Task decomposition direction

Do not record implementation Tasks until the boundary and observable first-release result are approved.
The likely first implementation outcome is an explicit owner-defined Task Backend contract with the existing SQLite behavior adapted to it and no second backend.
Split schema work only when it remains independently supported and verifiable.

## Authorization status

No implementation or Task Recording is authorized by this plan.
