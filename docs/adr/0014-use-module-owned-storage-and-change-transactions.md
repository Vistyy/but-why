---
status: accepted
---

# Use module-owned storage interfaces and Change-owned transactions

Task and Change own their behavior and persistence interfaces.
Submission executes the Validation Gate against a Candidate.
The Validation Gate reports its results through Change-owned interfaces for Candidates, Validation Runs, Findings, and Artifacts.
One repository storage composition module owns database lifecycle and constructs SQLite adapters for those interfaces.
Change owns the named atomic operations that cross persisted concepts for Change Start, Candidate capture, and Change completion.
CLI modules select an operation and translate its result without constructing storage or coordinating persistence.

This ADR supersedes ADR 0005 statements that assign Validation Run history and validation-start coordination to Validation Run storage or `ValidationRuns`.
The remaining ADR 0005 decisions stay accepted.
The private SQLite implementation still owns SQL execution and transaction mechanics.
The owning module defines each transaction's behavior and invariants.
The private implementation may share SQL, row mapping, and transaction mechanics.
Each workflow receives only its required operations through small functions or objects.
No generic store, orchestration zone, or transaction interface exposes unrelated persistence operations to callers.

## Considered Options

- Keep broad local-orchestration and SQLite-store modules that mirror the current dependency graph.
- Let CLI modules construct stores and coordinate persistence.
- Expose one generic repository store or transaction interface.
- Give each domain-centered module a narrow persistence interface and centralize adapter construction.

## Consequences

- Fallow zones and allowances follow module ownership rather than implementation history.
- Broad `local-orchestration`, `use-cases`, and `sqlite-concrete-stores` architecture concepts are removed.
- Cross-concept transactions remain explicit Change operations rather than generic database capabilities.
- Repository composition may depend on concrete adapters, but behavior modules and CLI callers may not.
- Storage migration and source consolidation must preserve these ownership rules.
