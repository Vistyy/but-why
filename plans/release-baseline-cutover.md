# First-release baseline and state cutover plan

**Status:** Approved planning direction.
The approved Task and Change boundary and Agent Session plans supply its required ownership direction.
It is not implementation authority.

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
Use JSON for complete document snapshots and ordered embedded evidence that have no independent relational operations.
Keep operational state, external mutation identity, foreign-key relationships, and independently constrained facts as columns rather than using JSON only to reduce column count.

## Required design inputs

Do not finalize the physical baseline until these approved plans supply their applicable ownership and persistence requirements:

- `task-change-boundary.md`.
- `agent-session-execution.md`.

Candidate Publication presentation is not a baseline prerequisite.
The baseline represents the currently supported Candidate Publication behavior.
A later accepted presentation design adds its storage through a normal post-baseline migration.

The baseline review must inspect every retained table and column against a current domain, query, transaction, inspection, or recovery requirement.
It must review required values, types, state constraints, uniqueness, foreign keys, all-or-none relationships, and indexes supported by actual Adapter operations.

Avoid cross-table triggers and broad defensive constraints when owner workflows and atomic persistence operations already enforce the invariant.
Use same-row SQLite `CHECK` constraints only for supported enum values and these required combinations:

- Task `cancelled` state and cancellation reason presence.
- Change `close_reason` and cancellation reason presence.
- Agent Invocation settlement time and settlement kind presence.
- Task Reviewer configuration and Task Reviewer Agent Session ID presence.

Owner operations enforce cleanup combinations, validation outcomes against embedded evidence, GitHub Publication Candidate and Validation Run agreement, Acceptance Context against the Task link, phase and producer meaning, JSON shape, and non-whitespace text.
Direct database modification outside But Why remains unsupported.

## Current retained directions

`shared_state_identity` remains required to bind state to the canonical Git Common Directory and support immediate transaction locking.
The Change Execution Lock remains one separate SQLite coordination file per Change rather than baseline state, a main-database lease, or an in-process Effect lock.
It provides cross-process exclusion for conflicting long-running Change operations while allowing operations on different Changes to proceed concurrently.
Domain timestamps remain ISO timestamp text where current reads rely on lexical ordering.

Accepted baseline direction:

- Keep Task identity, title, description, lifecycle state, cancellation reason, nullable resolved Task Reviewer configuration, and nullable Task Reviewer Agent Session ID on `tasks`.
  Keep direct Task Dependency relationships in `task_dependencies`.
  Store each Task Review's exact proposal and dependency evidence as immutable JSON snapshots, with its Review Base ref and commit, nullable outcome, Findings, optional Tooling Failure, and cleanup obligation directly on `task_reviews`.
  Task Reviews use their Task's stored reviewer configuration rather than duplicating it.
  Do not add separate proposal, dependency-evidence, policy, Finding, or Tooling Failure tables.
- Keep Change public and numeric IDs, Repository Branch, Change Base ref and remote URL, Managed Worktree path, optional initial Acceptance Context, reviewer configuration snapshot, closure fields, and cleanup obligation directly on `changes`.
  Keep the optional one-to-one Task relationship only in `task_change_links`.
  Keep Decisions, Blockers, Candidates, Validation Runs, and GitHub Publication in their owner-specific history or operation tables.
  Do not store the starting commit, Git Common Directory, mutable current Acceptance Context, Current Candidate pointer, or Active Validation Run pointer on Change.
- Keep `candidates.change_id` as the authoritative Candidate-to-Change relationship so Change operations can query Candidate history directly.
  Store the exact fetched `base_commit` and Repository Branch `head_commit` on every Candidate because validation, publication, and exact-merge verification require both.
  Derive the Current Candidate as the latest Candidate selected for a Change and store no current-candidate pointer or selection table.
  Reuse the latest Candidate when a repeated capture has the same exact Change Base and head commits.
  If a Change selects Candidate A, then B, then returns to A's exact commits, record a new Candidate occurrence and require Validation again rather than reselecting the historical A.
  Candidate therefore represents one selected committed-state occurrence, not the unique identity of a commit pair across the complete Change history.
  Do not add a uniqueness constraint across Change and commit pair.
  Index `(change_id, id DESC)` to find the Current Candidate and list Candidate history by immutable Candidate order.
- Store only Snapshot Workspace cleanup obligation on its Task Review or Validation Run and do not retain a separate workspace table or stored Snapshot Workspace path.
  Derive and verify the exact deterministic path from the canonical main checkout and Review or Validation Run ID before cleanup.
  Derive a Validation Snapshot Workspace's expected commit from its immutable Candidate.
  Continue storing the Change Managed Worktree path because Change recovery preserves its originally recorded location.

Schema simplification candidates still subject to final review:

- Derive an Active Validation Run by selecting a Validation Run with no outcome through its Candidate and Change.
  The immediate SQLite start transaction checks the complete Change for any unfinished Run, confirms the selected Candidate is current, and creates the new Run atomically.
  Do not add an Active Validation Run table, Change pointer, or per-Candidate partial uniqueness index.
- Require every Change to be created through Change Start with a Repository Branch, Change Base ref and remote URL, and Managed Worktree path.
  Candidate capture operates only on an existing Open Change and does not implicitly create one.
  This first-release requirement applies to the current local Managed Worktree model and does not define a future cloud Implementer contract.
- Do not persist the Change starting commit after Change Start.
  Publication for a Change without Acceptance Context derives its first implementation commit from the exact Candidate Change Base and head commits.
- Store the canonical Git Common Directory only in `shared_state_identity`, not on every Change.
  Repository Branch identity is repository-scoped by the Shared Repository State database.
- Store the initial Acceptance Context on the Change and each approved Resolution on its Implementation Blocker.
  Derive the current Acceptance Context by applying ordered Resolutions rather than storing a mutable second copy on the Change.
  For a Change without a Task and initial Acceptance Context, a Resolution unblocks implementation but does not create Acceptance Context or cause Acceptance Review to run.
  Each Validation Run retains the exact resulting Acceptance Context it reviewed when one exists.
- Keep the core Change representation independent of GitHub.
  Store current GitHub-specific delivery evidence in a separate one-to-zero-or-one `github_publications` table with `change_id` as its primary key.
  Do not add a separate publication ID because no current record references Publication independently.
  Create the row with the exact publication Candidate and passing Validation Run before creating the pull request.
  After GitHub creation succeeds or is reconciled, store the pull request number needed during external-mutation recovery.
  Derive the pull request URL from the recorded GitHub repository and pull request number rather than storing it.
  Before a pull request exists, a later Candidate replaces the pending row's Candidate and Validation Run.
  Once a pull request exists, the row remains bound to that pull request and changes only after remote reconciliation.
  `validation_runs.candidate_id` references its Candidate, and `github_publications` references both the Candidate and Validation Run.
  The atomic publication operation verifies that both references identify the same Candidate and Change and that the Validation Run passed.
  Do not add composite keys solely to duplicate that owner-operation check in SQLite.
  Do not duplicate `change_id` on Validation Run.
  Do not add a generic delivery-provider abstraction before another delivery route is supported.
  A future local or other-forge delivery route can add its own representation without adding GitHub fields to `changes`.
  Derive publication owner and repository from the recorded base remote URL, base branch and remote name from the recorded base ref, head branch from the Repository Branch, and expected head commit from the immutable Candidate.
  Validation and Publication remain separate Change-owned operations.
  Publication must verify that its exact Candidate has the referenced passing Validation Run and that all derived repository, branch, pull request, and merge facts match before external mutation or completion.
- Do not store duplicated lifecycle state on Changes, Task Reviews, or Validation Runs.
  A Change uses one nullable `close_reason`: `NULL` means Open, while `completed` and `cancelled` mean Closed.
  Store a non-whitespace `cancel_reason` only for `cancelled`, with no separate Change state or close timestamp.
  The Change operation validates the reason rather than using a SQLite text constraint.
  A Validation Run uses one nullable `outcome`: `NULL` means active, while `passed`, `blocked`, and `tooling_failed` are complete outcomes.
  A Task Review uses the same nullable `outcome` values and meaning, with no separate Review state column.
  A partial unique index on `task_reviews.task_id` where `outcome IS NULL` enforces at most one Active Task Review per Task.
- Remove Task and Change `created_at` and `updated_at`, and remove Change `closed_at`.
  Their repository-local numeric IDs already provide creation order, and no supported operation requires those event times.
- Represent each Change, Task Review, and Validation Run cleanup obligation directly with `cleanup_pending` and nullable `cleanup_blocking_reason` on its owning row.
  Owner operations create, clear, or retain that obligation and its actionable failure reason.
  Do not add cleanup timestamps, separate cleanup tables, or SQLite field-combination constraints.
- Store immutable Task Review Findings as an ordered JSON value and its optional Tooling Failure as one embedded value on the Task Review.
  Do not retain separate Task Review Findings or Tooling Failures tables.
- Store a phase- or producer-specific Validation Tooling Failure on its `validation_phase_results` row.
  Store only Run-level failures, such as Snapshot Workspace setup failure or abandonment, on the Validation Run.
  Do not retain a separate Tooling Failures table or one Run-level array that mixes both scopes.
- Keep one Validation Phase Result row per Validation Run, phase, and producer because phases settle independently.
  Row existence means that phase and producer settled, so do not add separate phase state or round number.
  Enforce uniqueness on `(validation_run_id, phase, producer)`.
  Store that phase result's immutable Findings and Artifact metadata as ordered JSON values and its optional Tooling Failure as one embedded value.
  Store one optional Run-level Tooling Failure directly on the Validation Run.
  Evidence becomes immutable when its Task Review, Validation Phase Result, or Validation Run owner completes.
  Do not retain separate Findings or Artifacts tables.
- Artifact JSON retains path, original bytes, and stored bytes.
  Derive its reference from its owning phase and path and derive truncation from stored bytes being less than original bytes.
- Remove Task Review `abandon_reason` because its Tooling Failure already retains the abandonment reason.
- Remove Validation Round `round_number` and use the fixed phase and producer identity.
- Shared Agent storage retains Agent Sessions, physical continuations, and Invocations.
  Store no compatibility fingerprint.
  The Task stores its resolved Task Reviewer configuration as a nullable immutable JSON snapshot when its Task Reviewer Session first starts.
  The Change stores all configured reviewer roles and their resolved configurations as one immutable JSON snapshot at Change Start, before their Agent Sessions are created lazily.
  These embedded configurations have no independent relational lifecycle and do not require separate configuration tables.
  Validate a resolved snapshot before storage.
  Later Repo or Global Config changes do not alter stored configurations after a usable continuation exists, and replacement continuations reuse them.
  If the first launch proves that no usable continuation was established, a retry may replace only that owner-role configuration from corrected current config.
  Task Reviews and Validation Runs use their owner's stored reviewer configuration rather than duplicating it.
  Prepare, Checks, Acceptance Context, and the output contract remain captured independently for each Validation Run rather than being frozen at Change Start.
  For first-release Pi, store the nullable transcript-relative path on its physical continuation and do not retain a separate transcript-reference table.
  Domain operations reach that transcript through their Invocation links.
  A Task stores its one Task Reviewer Agent Session ID directly.
  `change_agent_sessions` maps each Change reviewer producer to its Agent Session.
  Task Reviews and Validation Phase Results use domain-owned link tables to identify their Invocations.
  Agent Sessions, continuations, and Invocations each use one repository-local immutable integer identity that also orders their history.
  Continuations reference their Agent Session, and Invocations reference their continuation.
  Derive the first-release Pi session ID deterministically from the continuation ID and do not store a separate Pi session ID or harness name.
  Keep the nullable transcript-relative path because Pi's transcript filename is not fully deterministic.
  The latest continuation for an Agent Session is current, so do not store a current pointer, `superseded_at`, or replacement metadata.
  The pre-dispatch SQLite transaction joins through continuations to reject an unsettled Invocation for the same Agent Session.
  Invocation settlement times, settlement kind, and token usage remain for recovery and usage reporting.
- Use repository-wide immutable integer identities as append order for Task Reviews, Candidates, Validation Runs, Agent Sessions, continuations, Invocations, Implementation Decisions, and Implementation Blockers.
  Immutable history rows are not deleted, and IDs are allocated transactionally within JavaScript-safe integers without `AUTOINCREMENT`.
- Keep `implementation_decisions` because Decisions are appended independently and Validation Runs must identify the exact non-authoritative rationale supplied to the Acceptance Reviewer.
  Each Run stores the highest included Decision ID and reconstructs the immutable Change-owned prefix.
  Keep `implementation_blockers` because Blockers are created unresolved, resolved later, queried as active operational state, and supplied as ordered validation history.
  Use repository-wide immutable append sequence values as the identities of Implementation Decisions and Implementation Blockers.
  Change operations require non-whitespace Decision fields and Blocker content before storage without SQLite text-format constraints.
  Do not retain separate Decision, Blocker, or Resolution UUIDs or a Resolution sequence.
  The Blocker ID identifies and orders its optional one-to-one Resolution.
  A Blocker owns at most one Resolution, represented by nullable `resolution_content` on its Blocker row, and Validation references use the stable Blocker sequence.
  `NULL` means unresolved and non-whitespace text means resolved, so no separate Resolution table, `resolved_at` column, or all-or-none Resolution constraint is required.
  The Change operation validates non-whitespace Resolution content before storage rather than adding a SQLite text constraint.
  A partial unique index enforces at most one unresolved Blocker per Change.
  A Validation Run stores the highest Implementation Decision and Implementation Blocker sequences included when it starts, plus the exact latest resolved Blocker sequence required by current validation rules when applicable.
  The Run reconstructs those immutable histories by selecting records for its Change through those sequence boundaries rather than copying them into the Run.
- Do not store timestamps merely to order records that already have immutable integer order.
  Remove creation and update timestamps from Task Reviews, Candidates, Validation Runs, Decisions, Blockers, Findings, Artifacts, phase results, and other records without a separate time-based behavior.
  Retain timestamps only for real elapsed-time or external-event evidence, including Agent Invocation dispatch and settlement and any external mutation or cleanup recovery that requires time.
- Retain only indexes justified by current predicates, ordering, uniqueness, or active-row invariants.

These are candidates, not authorization for a specific final schema.

## Approved baseline table inventory

Repository Runtime owns:

- `shared_state_identity`.

Tasks own:

- `tasks`.
- `task_dependencies`.
- `task_reviews`.
- `task_review_agent_invocations`.

Task and Change coordination owns:

- `task_change_links`.

Changes own:

- `changes`.
- `implementation_decisions`.
- `implementation_blockers`.
- `candidates`.
- `validation_runs`.
- `validation_phase_results`.
- `validation_phase_agent_invocations`.
- `change_agent_sessions`.
- `github_publications`.

Shared Agent infrastructure owns:

- `agent_sessions`.
- `agent_continuations`.
- `agent_invocations`.

No other product-owned baseline table is planned.
Effect SQL retains its dependency-owned migration ledger.

## Prerelease archive

The existing prerelease Shared Repository State remains useful historical evidence but does not need to remain executable by `0.1.0`.
Archive the complete prerelease operational state separately rather than preserving only `state.sqlite`.
The archive preserves the old executable revision and sufficient identity and integrity evidence to inspect the historical state reliably.
It includes the complete Git Common Directory But Why state, repository reviewer files, archive timestamp, repository identity, a SHA-256 manifest, and short instructions for inspecting a copy with the old executable revision.
It needs no special archive format or signature.
The released `by` CLI does not read or import the prerelease archive.

Keep the existing loose SQLite backups until the final prerelease archive is verified.
After verification, remove those loose copies and retain only the new active `state.sqlite` and the single final prerelease archive.

## Cutover sequence

Only implementation work that must complete before cutover should be recorded in the prerelease database.
The baseline Candidate must be submitted, merged, and reconciled with the old Trusted But Why Executable before that executable loses access to prerelease state.
The Operator coordinates the brief write pause manually; do not add product maintenance mode or distributed locking for this cutover.
Then:

1. Merge the baseline with the old Trusted But Why Executable.
2. Briefly stop But Why writes.
3. Archive the old operational state, including the Git Common Directory state and repository reviewer files.
4. Preserve that archive without rewriting the old database.
5. Initialize the new Shared Repository State from merged `main`.
6. Verify the new Trusted But Why Executable and state before recording new work.
7. Resume development in the new state and finish release work before npm publication.

Verification is bounded to archive integrity, old-state SQLite readability, the new baseline migration, repository identity, and basic trusted CLI access.
If verification fails before new work is recorded, the Operator manually restores use of the preserved old state.
After new work is recorded, fix the new state forward and do not merge old and new databases.
Do not add released rollback or database-conversion commands for this one-time cutover.

A fresh clone may be used for initialization as an operational safety convenience, but it is not required.
The exact manual operational procedure remains unresolved.

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

The planned baseline Change explicitly retires and deletes the prerelease migration files, registration, upgrade tests, and active support after its state is archived.
Git history and the prerelease archive preserve the old executable revision and migration chain for inspection.
This is an accepted one-time exception to ADR 0009's current consequence that the first release ships the complete prerelease chain.
ADR 0009's governing decision remains applicable: migrations are immutable and schema changes use ordered forward migrations.
After implementation, amend ADR 0009 rather than superseding it.
The amendment records that the prerelease chain was explicitly retired at the first-release boundary, the new `0001_baseline` became the immutable migration root, and normal forward-only migration continues from there.
Do not change current architecture or ADR authority before implementation.

## Implementation-time procedure

Define and test the exact manual trusted-executable cutover commands during baseline implementation, when the implemented baseline CLI and archive layout are available.
Review the runbook before cutover and store the old-state inspection instructions in the archive.
Do not add product cutover, rollback, or prerelease conversion commands.

## Authorization status

No baseline implementation, state mutation, archive operation, Task Recording, or cutover is authorized by this plan.
