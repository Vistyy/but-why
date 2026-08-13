# First-release baseline and state cutover plan

**Status:** Paused pending the Task Intent extraction boundary.
Schema ownership and the released baseline cannot be selected until that boundary is resolved.
Do not use this plan as current planning direction or implementation authority.

**Removal condition:** Remove this file after the released baseline is implemented, the prerelease state is archived, the cutover is completed, and accepted authority changes are recorded in current artifacts.

## Outcome

The first public release initializes Shared Repository State from one reviewed `0001_baseline` that represents only the supported `0.1.0` system.
The prerelease migration chain and database representation are retired at the release boundary rather than supported through compatibility behavior.
All migrations after the release baseline are immutable, ordered, and forward-only.

## Baseline rules

- Construct `0001_baseline` from the accepted final domain model.
- Do not concatenate historical migrations or blindly copy `sqlite_schema`.
- Do not ship prerelease import behavior, migration shims, ledger rewriting, or compatibility for the retired prerelease database.
- Use plain `CREATE TABLE` statements so unexpected existing objects fail initialization.
- Apply the established `STRICT` and JavaScript-safe integer constraints consistently to product-owned tables where their runtime contracts require them.
- Keep Effect SQL's dependency-owned migration ledger under the dependency's representation.
- Require applied numeric migration IDs to be an exact prefix of the packaged ordered migrations before applying remaining migrations.
- Treat descriptive migration names as non-authoritative for schema compatibility.
- Append a new Migration Artifact for every post-release schema change.

The schema must represent the current supported domain rather than hypothetical plugins, generic workflow machinery, or retired prerelease concepts.

## Required design inputs

Do not finalize the physical baseline until these plans establish their applicable ownership and persistence requirements:

- `task-backend-boundary.md`.
- `agent-session-execution.md`.
- `candidate-publication-presentation.md`.

The baseline review must inspect every retained table and column against a current domain, query, transaction, inspection, or recovery requirement.
It must review required values, types, state constraints, uniqueness, foreign keys, all-or-none relationships, and indexes supported by actual Adapter operations.

Avoid cross-table triggers and broad defensive constraints when owner workflows and atomic persistence operations already enforce the invariant.
Direct database modification outside But Why remains unsupported.

## Current retained directions

`shared_state_identity` remains required to bind state to the canonical Git Common Directory and support immediate transaction locking.
Execution locks remain separate SQLite coordination files rather than baseline tables.
Domain timestamps remain ISO timestamp text where current reads rely on lexical ordering.

Current schema simplification candidates remain subject to the owning plans and final review:

- Store Current Candidate directly on Change rather than retaining a separate current-selection table.
- Represent an active Validation Run directly through its Change relationship and running state rather than a separate active-row table.
- Replace validation-only Snapshot Workspace persistence with the Submission Workspace recovery behavior accepted by Candidate Publication planning.
- Retain Tooling Failure state only when it owns recovery or explains a final tooling-failed outcome.
- Remove free-text abandonment reasons when a standard Tooling Failure supplies the required evidence.
- Remove mutable-looking or duplicated Finding fields that no supported operation uses.
- Retain only indexes justified by current predicates, ordering, uniqueness, or active-row invariants.

These are candidates, not authorization for a specific final schema.

## Prerelease archive

The existing prerelease Shared Repository State remains useful historical evidence but does not need to remain executable by `0.1.0`.
Archive the complete prerelease operational state separately rather than preserving only `state.sqlite`.
The archive should preserve the old executable revision and sufficient identity and integrity evidence to inspect the historical state reliably.
The exact archive-operability level remains unresolved.

## Cutover sequence

Only implementation work that must complete before cutover should be recorded in the prerelease database.
The baseline Candidate must be submitted, merged, and reconciled with the old Trusted But Why Executable before that executable loses access to prerelease state.
Then:

1. Snapshot and archive the old operational state.
2. Preserve that archive without rewriting the old database.
3. Create a fresh Local Repository from merged released `main`, then initialize Shared Repository State in its Git Common Directory.
4. Record remaining release Tasks in the new Shared Repository State.

A fresh clone is preferred for initializing the released baseline because it does not delete or rewrite the archived prerelease state.
The exact operational procedure remains unresolved.

## Verification direction

Retain or adapt evidence for:

- Fresh initialization.
- Exact baseline ledger identity and prefix classification.
- Repository identity.
- Missing-state open behavior.
- Concurrent initialization and bounded migration contention.
- Foreign-key enforcement.
- `STRICT` product-owned tables.
- Material relational constraints and transaction behavior.
- Separate execution locks.

Remove verification whose only claim is upgrading or transforming a retired prerelease representation.

## Authority change

The planned baseline Change retires the complete prerelease schema after its state is archived.
This requires a separately accepted authority change that supersedes ADR 0009's requirement to preserve the prerelease migration chain through the first release.
After implementation, review the implemented system against the ADR gate and record the accepted one-time release-boundary decision if it qualifies.
Do not change current architecture or ADR authority before implementation and explicit acceptance.

## Decisions still required

- Accept the final Task Backend ownership representation.
- Accept the final Agent Session and execution representation.
- Accept Candidate Publication and Submission Workspace persistence behavior.
- Review the complete final table, column, relationship, and index inventory.
- Define archive contents and the required inspection procedure.
- Define the exact trusted-executable cutover procedure and rollback boundary.

## Authorization status

No baseline implementation, state mutation, archive operation, Task Recording, or cutover is authorized by this plan.
