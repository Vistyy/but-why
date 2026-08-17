# First-release baseline and state cutover plan

**Status:** Approved planning direction.
BY-269, BY-271, and BY-275 are completed prerequisites recorded by this plan, and BY-274 remains the direct baseline cutover.
The approved Task and Change boundary and Agent Session plans supply its required ownership direction.
It is not implementation authority.

**Removal condition:** Remove this file after the released baseline is implemented, the prerelease state is archived, the cutover is completed, and accepted authority changes are recorded in current artifacts.

## Outcome

BY-269 completed the Task and Change coordination boundary, including the durable one-to-one link, coordinated Change Start and cancellation, exact merged completion, joined inspection, and the one-transaction completion contract.
BY-271 completed internal Task and Change identities, immutable table-local numeric ordering, the frozen repository `idPrefix`, derived public IDs, and Change-owned operational names.
BY-275 completed the shared Agent Session and Agent Invocation design used by the final baseline.
BY-274 is the one remaining direct implementation Change for the first-release baseline and operational state cutover.
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

## Final schema authorities

BY-269, BY-271, and BY-275 are completed prerequisites for the exact BY-274 physical schema and settled contracts.
`task-change-boundary.md` and `agent-session-execution.md` supply the applicable ownership and persistence requirements.
Candidate Publication presentation is not a baseline prerequisite.
The baseline represents the currently supported Candidate Publication behavior.
A later accepted presentation design adds its storage through a normal post-baseline migration.

The ordinary BY-274 implementation conformance review must inspect every retained table and column against a current domain, query, transaction, inspection, or recovery requirement.
It must verify required values, types, state constraints, uniqueness, foreign keys, all-or-none relationships, and indexes supported by actual Adapter operations.

Avoid cross-table triggers and broad defensive constraints when owner workflows and atomic persistence operations already enforce the invariant.
Use same-row SQLite `CHECK` constraints only for supported enum values and these required combinations:

- Task `cancelled` state and cancellation reason presence.
- Change `close_reason` and cancellation reason presence.
- Agent Invocation settlement time and settlement kind presence.
- Agent Invocation physical token columns `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, and `total_tokens` are either all present or all absent.
- Task Reviewer configuration and Task Reviewer Agent Session ID presence.

Owner operations enforce cleanup combinations, validation outcomes against embedded evidence, GitHub Publication Candidate and Validation Run agreement, Acceptance Context against the Task link, phase and producer meaning, JSON shape, and non-whitespace text.
Direct database modification outside But Why remains unsupported.

## Final retained contracts

`shared_state_identity` remains required to bind state to the canonical Git Common Directory, freeze the repository ID Prefix, and support immediate transaction locking.
The Change Execution Lock remains one separate SQLite coordination file per Change rather than baseline state, a main-database lease, or an in-process Effect lock.
It provides cross-process exclusion for conflicting long-running Change operations while allowing operations on different Changes to proceed concurrently.
Domain timestamps remain ISO timestamp text where current reads rely on lexical ordering.

Final physical schema and settled contracts:

- Keep Task identity, title, description, lifecycle state, cancellation reason, nullable resolved Task Reviewer configuration, and nullable Task Reviewer Agent Session ID on `tasks`.
  An unlinked Task cannot become Done; exact merged completion of its linked Change is the only completion path.
  Keep direct Task Dependency relationships in `task_dependencies`.
  Store each Task Review's exact proposal and dependency evidence as immutable JSON snapshots, with its Review Base ref and commit, nullable outcome, Findings, optional Tooling Failure, and cleanup obligation directly on `task_reviews`.
  Task Reviews use their Task's stored reviewer configuration rather than duplicating it.
  Do not add separate proposal, dependency-evidence, policy, Finding, or Tooling Failure tables.
- Give `tasks` and `changes` independent SQLite-allocated table-local `INTEGER PRIMARY KEY` identities.
  Store the repository's immutable `id_prefix` once in `shared_state_identity` and derive public Task and Change IDs at the application boundary as `<id-prefix>-<task-number>` and `<id-prefix>-C<change-number>`.
  Use integer foreign keys internally and do not store duplicated public ID strings on domain rows.
  Repository initialization freezes `id_prefix`; opening Shared Repository State rejects a conflicting configured `idPrefix` with actionable failure behavior.
  Keep Change Repository Branch, Change Base ref and remote URL, Managed Worktree path, optional initial Acceptance Context, reviewer configuration snapshot, closure fields, and cleanup obligation directly on `changes`.
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

- Derive an Active Validation Run by selecting a Validation Run with no outcome through its Candidate and Change.
  The immediate SQLite start transaction checks the complete Change for any unfinished Run, confirms the selected Candidate is current, and creates the new Run atomically.
  Do not add an Active Validation Run table, Change pointer, or per-Candidate partial uniqueness index.
- Require every Change to be created through Change Start with a Repository Branch, Change Base ref and remote URL, and Managed Worktree path.
  Resolve and validate the reviewer configuration from Repo Config at the exact starting commit, current Global Config, and their resolved guidance and resources before creating the Change.
  Invalid reviewer configuration rejects Start without creating a Change.
  After Git intent and reviewer configuration resolve, Task and Change coordination atomically creates the Change, its reviewer configuration snapshot, and its optional Task link.
  Managed Worktree provisioning and Repository Preparation then run against the durable Open Change.
  Their failure preserves the Change and intended Managed Worktree path for supported retry.
  Later Candidate configuration may change per-Run Prepare and Checks but cannot change the Change reviewer roster or configuration.
  Candidate capture operates only on an existing Open Change and does not implicitly create one.
  This first-release requirement applies to the current local Managed Worktree model and does not define a future cloud Implementer contract.
- Do not persist the Change starting commit after Change Start.
  Publication for a Change without Acceptance Context derives its first implementation commit from the exact Candidate Change Base and head commits.
- Store the canonical Git Common Directory and immutable repository ID Prefix only in `shared_state_identity`, not on every Task or Change.
  Repository Branch identity is repository-scoped by the Shared Repository State database.
- Store the initial Acceptance Context on the Change and each approved Resolution on its Implementation Blocker.
  Derive the current Acceptance Context by applying ordered Resolutions rather than storing a mutable second copy on the Change.
  For a Change without a Task, a Resolution unblocks implementation but does not create Acceptance Context or cause Acceptance Review to run.
  Each Validation Run retains the exact resulting Acceptance Context it reviewed when one exists.
- Keep the core Change representation independent of GitHub.
  Store current GitHub-specific delivery evidence in a separate one-to-zero-or-one `github_publications` table with the internal integer `change_id` as its primary key.
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
  The Task stores its resolved Task Reviewer configuration as a nullable JSON snapshot when its Task Reviewer Agent Session first launches.
  The Change stores its fixed reviewer roster and each role's resolved configuration as one JSON snapshot at Change Start, before their Agent Sessions are created lazily.
  These embedded configurations have no independent relational lifecycle and do not require separate configuration tables.
  Validate a resolved snapshot before storage.
  Later Repo or Global Config changes do not alter stored configurations after a usable continuation exists, and replacement continuations reuse them.
  A retry may replace only that owner-role configuration from corrected current config when no Invocation has returned, no transcript exists, and the latest Invocation settled as `launch_failed` because no conversation was established.
  Replacement never changes the Change reviewer roster.
  Once the harness establishes a conversation, that owner-role configuration remains fixed permanently.
  Missing or unusable transcript recovery uses that same configuration.
  Task Reviews and Validation Runs use their owner's stored reviewer configuration rather than duplicating it.
  Prepare, Checks, Acceptance Context, and the output contract remain captured independently for each Validation Run rather than being frozen at Change Start.
  For first-release Pi, store the nullable transcript-relative path and nullable unusable reason on its physical continuation and do not retain a separate transcript-reference table.
  A continuation is resumable only when its transcript path is present and no unusable reason is recorded.
  Do not add a replacement pointer, generic continuation status, or superseded timestamp.
  Domain operations reach that transcript through their Invocation links.
  A Task stores its one Task Reviewer Agent Session ID directly.
  `change_agent_sessions` maps each Change reviewer producer to its Agent Session.
  Task Reviews use a domain-owned link table to identify their Invocations.
  Before a reviewer phase dispatch, `validation_phase_agent_invocations` links its Validation Run, phase, producer, and Invocation without referencing a not-yet-created Phase Result.
  After settlement, `validation_phase_results` records the same Run, phase, and producer identity with its result.
  Agent Sessions, continuations, and Invocations each use one table-local immutable `INTEGER PRIMARY KEY` that also orders that table's history.
  SQLite allocates these IDs without the `AUTOINCREMENT` keyword or application `MAX(id) + 1` queries.
  Continuations reference their Agent Session and store the required Agent Harness name, nullable model provider, required selected model slug, and nullable thinking level used for their physical conversation.
  The first release records `pi` as the harness; explicit storage is durable query evidence and does not add support for another harness.
  Invocations reference their continuation and store nullable physical columns `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, and `total_tokens` as one all-present or all-absent measured set.
  Derive the first-release Pi session ID deterministically from the continuation ID and do not store a separate Pi session ID.
  Keep the nullable transcript-relative path because Pi's transcript filename is not fully deterministic.
  The highest-ID continuation for an Agent Session is current for dispatch and recovery inspection, so do not store a current pointer, `superseded_at`, or replacement metadata.
  Dispatch creates a continuation when none exists, reuses the current continuation only when it has a transcript path and no unusable reason, and otherwise appends a replacement with the same stored configuration.
  Transcript capture failure belongs to the continuation's `unusable_reason`; Invocation settlement continues to describe only the harness call.
  The pre-dispatch SQLite transaction joins through continuations to reject an unsettled Invocation for the same Agent Session.
  Invocation settlement times, settlement kind, and the five physical token columns remain for recovery and usage reporting.
  First-release settlement kinds are `returned`, `launch_failed`, `failed`, and `return_unknown`.
  Invalid structured output is a returned Invocation followed by a correction Invocation.
- Use table-local immutable `INTEGER PRIMARY KEY` identities as append order for Task Reviews, Candidates, Validation Runs, Agent Sessions, continuations, Invocations, Implementation Decisions, and Implementation Blockers.
  SQLite allocates IDs transactionally within JavaScript-safe integers without the `AUTOINCREMENT` keyword, a shared sequence table, or application `MAX(id) + 1` queries.
  Immutable history rows are not deleted.
- Keep `implementation_decisions` because Decisions are appended independently and Validation Runs must identify the exact non-authoritative rationale supplied to the Acceptance Reviewer.
  Each Run stores the highest included Decision ID and reconstructs the immutable Change-owned prefix.
  Keep `implementation_blockers` because Blockers are created unresolved, resolved later, queried as active operational state, and supplied as ordered validation history.
  Give Implementation Decisions and Implementation Blockers separate table-local SQLite-allocated integer identities.
  Each identity orders only its own record type; no shared Decision-and-Blocker sequence or cross-type ordering is required.
  Change operations require non-whitespace Decision fields and Blocker content before storage without SQLite text-format constraints.
  Do not retain separate Decision, Blocker, or Resolution UUIDs or a Resolution sequence.
  The Blocker ID identifies and orders its optional one-to-one Resolution.
  A Blocker owns at most one Resolution, represented by nullable `resolution_content` on its Blocker row, and Validation references use the stable Blocker ID.
  `NULL` means unresolved and non-whitespace text means resolved, so no separate Resolution table, `resolved_at` column, or all-or-none Resolution constraint is required.
  The Change operation validates non-whitespace Resolution content before storage rather than adding a SQLite text constraint.
  A partial unique index enforces at most one unresolved Blocker per Change.
  A Validation Run stores only the highest Implementation Decision and Implementation Blocker IDs included when it starts.
  The Run reconstructs those immutable histories by selecting records for its Change through those integer boundaries rather than copying them into the Run.
  Do not store a separate latest-resolved-Blocker ID because at most one Blocker can be unresolved, a new Blocker cannot be raised until it is resolved, and Validation cannot start with an unresolved Blocker.
  The highest included Blocker is therefore also the latest resolved Blocker at Run start.
- Do not store timestamps merely to order records that already have immutable integer order.
  Remove creation and update timestamps from Task Reviews, Candidates, Validation Runs, Decisions, Blockers, Findings, Artifacts, phase results, and other records without a separate time-based behavior.
  Retain timestamps only for real elapsed-time or external-event evidence, including Agent Invocation dispatch and settlement and any external mutation or cleanup recovery that requires time.
- Public inspection may retain lifecycle states that are derived rather than stored.
  Change inspection derives `open` or `closed` from `close_reason`.
  Task Review and Validation Run inspection derives `active` or `complete` from nullable `outcome`.
  Remove `createdAt`, `updatedAt`, `closedAt`, and derived age output when their source timestamps are removed, and order public histories by immutable integer ID.
- Replace reviewer execution aggregates with exact ordered Invocation evidence in Task Review and Validation phase inspection.
  Do not expose compatibility fingerprint, continuity, review-call count, or aggregate reviewer duration.
  Each Invocation projection identifies its Invocation, Agent Session, and continuation; the continuation Agent Harness, nullable model provider, model, and nullable thinking level; dispatch and settlement timestamps; settlement kind; nullable all-or-none input, `cacheRead`, `cacheWrite`, output, and total token usage; transcript-relative path; and unusable reason.
  Keep command-duration evidence when it describes an actual check execution.
- Snapshot Workspace inspection may expose its deterministic derived path for recovery, but the path is not persisted.
  Continue exposing its cleanup obligation and blocking reason.
- Retain only indexes justified by current predicates, ordering, uniqueness, or active-row invariants.

The preceding physical choices are exact BY-274 schema contracts.
Ordinary implementation conformance review verifies that the implementation matches them.

## Exact physical contracts

The `changes` table contains:

- `id INTEGER PRIMARY KEY`, allocated by SQLite and constrained to the JavaScript-safe positive integer range.
- Required unique `branch_ref`.
- Required `base_ref` and `base_remote_url`.
- Required unique `worktree_path`, which records the intended location before provisioning so failure remains retryable.
- Nullable `initial_acceptance_context` JSON.
- Required `reviewer_configuration` JSON containing the fixed roster and each role's resolved configuration at Change Start, subject only to the approved pre-conversation role-configuration correction.
- Nullable `prepare_definition` JSON that freezes the exact Repository Preparation command and timeout for retry.
- Nullable `prepare_failure` JSON containing the latest retained preparation failure evidence.
- Nullable `close_reason` and `cancel_reason`.
- Required integer Boolean `cleanup_pending` and nullable `cleanup_blocking_reason`.

The Change row does not store its derived public ID, Task link, starting commit, current Acceptance Context, lifecycle state, or timestamps.
The current Acceptance Context is derived from its initial context and ordered approved Blocker Resolutions.
Lifecycle state is derived from `close_reason`.
Task linkage remains exclusively in `task_change_links`.

The `tasks` table contains:

- `id INTEGER PRIMARY KEY`, allocated by SQLite and constrained to the JavaScript-safe positive integer range.
- Required `title` and `description`.
- Required `state` constrained to `new`, `todo`, `done`, or `cancelled`.
- Nullable `cancel_reason` with the approved cancellation-state combination constraint.
- Nullable `reviewer_configuration` JSON, fixed after its Task Reviewer conversation is established and subject only to the approved pre-conversation correction.
- Nullable unique `reviewer_agent_session_id` referencing `agent_sessions`.
- The approved all-present or all-absent constraint across reviewer configuration and Agent Session ID.

The Task row does not store its derived public ID or timestamps.
`task_dependencies` contains required integer `dependent_task_id` and `prerequisite_task_id` foreign keys with their pair as its primary key.

The `task_reviews` table contains:

- `id INTEGER PRIMARY KEY`, allocated by SQLite and constrained to the JavaScript-safe positive integer range.
- Required integer `task_id` foreign key.
- Required `proposal` and `dependency_evidence` JSON snapshots.
- Required `base_ref` and `base_commit`.
- Nullable `outcome` constrained to `passed`, `blocked`, or `tooling_failed` when present.
- Required ordered `findings` JSON and nullable `tooling_failure` JSON.
- Required integer Boolean `cleanup_pending` and nullable `cleanup_blocking_reason`.

A partial unique index on `task_reviews.task_id` where `outcome IS NULL` permits at most one Active Task Review per Task.
The Task Review row does not store lifecycle state, reviewer policy, Snapshot Workspace path, reviewer aggregates, abandonment reason, or timestamps.
`task_review_agent_invocations` contains required integer `task_review_id` and `agent_invocation_id` foreign keys with their pair as its primary key.
Invocation ID supplies their order.

Small stable lifecycle sets that control persistence queries and transitions use SQLite `CHECK` constraints and application decoding.
This includes Task state, Task Review outcome, Validation Run outcome, and Validation Phase Result outcome.
Open-ended or evolving classifications, including tooling error kinds and producer names, remain application-decoded unless a relational invariant requires a later constraint.

`implementation_decisions` contains a SQLite-allocated safe positive `id INTEGER PRIMARY KEY`, required integer `change_id` foreign key, and required `choice` and `rationale`.
`implementation_blockers` contains a SQLite-allocated safe positive `id INTEGER PRIMARY KEY`, required integer `change_id` foreign key, required `content`, and nullable `resolution_content`.
Neither table stores UUIDs, separate sequence values, or timestamps.

`candidates` contains a SQLite-allocated safe positive `id INTEGER PRIMARY KEY`, required integer `change_id` foreign key, and required `base_commit` and `head_commit`.
It has no timestamps or commit-pair uniqueness constraint.

The `validation_runs` table contains:

- `id INTEGER PRIMARY KEY`, allocated by SQLite and constrained to the JavaScript-safe positive integer range.
- Required integer `candidate_id` foreign key.
- Required immutable `policy_snapshot` JSON.
- Nullable integer `highest_decision_id` and `highest_blocker_id` foreign keys.
- Nullable `outcome` constrained to `passed`, `blocked`, or `tooling_failed` when present.
- Nullable `run_tooling_failure` JSON.
- Required integer Boolean `cleanup_pending` and nullable `cleanup_blocking_reason`.

The Validation Run row does not store lifecycle state, Change ID, Active Run identity, latest-resolved-Blocker identity, or timestamps.

`validation_phase_results` contains required integer `validation_run_id`, required `phase` and `producer`, required `outcome` constrained to `passed` or `failed`, required ordered `findings` and `artifacts` JSON, and nullable `tooling_failure` JSON.
Its primary key is `(validation_run_id, phase, producer)`.
It stores no round number, state, or timestamps.

`validation_phase_agent_invocations` contains required integer `validation_run_id`, required `phase` and `producer`, and required integer `agent_invocation_id` foreign key.
Its primary key is `(validation_run_id, phase, producer, agent_invocation_id)` so correction and recovery Invocations remain ordered by Invocation ID.
It links before dispatch without requiring a Phase Result row.

`agent_sessions` contains only a SQLite-allocated safe positive `id INTEGER PRIMARY KEY`.
Owner and role remain in domain-owned links.

The `agent_continuations` table contains:

- A SQLite-allocated safe positive `id INTEGER PRIMARY KEY`.
- Required integer `agent_session_id` foreign key.
- Required `harness` and `model`.
- Nullable `provider` and `thinking`.
- Nullable `transcript_path` and `unusable_reason`.

These execution dimensions describe the physical conversation.
The first release stores `pi` as the harness, while provider may be absent when Pi cannot report it reliably.
WezTerm, Herdr, and `InteractiveSessionHost` are not Agent Harness values.

The domain token fields `input`, `cacheRead`, `cacheWrite`, `output`, and `total` correspond respectively to physical `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, and `total_tokens`.
The five physical Agent Invocation token columns are either all present or all absent.

The `agent_invocations` table contains:

- A SQLite-allocated safe positive `id INTEGER PRIMARY KEY`.
- Required integer `continuation_id` foreign key.
- Required `created_at` and nullable `settled_at`.
- Nullable application-decoded `settlement_kind`.
- Nullable safe nonnegative integer `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, and `total_tokens`.

Settlement time and kind are both absent or both present.
The five physical token columns are all absent or all present.

`change_agent_sessions` contains required integer `change_id`, required application-decoded `producer`, and required unique integer `agent_session_id` foreign key.
Its primary key is `(change_id, producer)`.
`task_change_links` contains required integer `task_id` as its primary key and required unique integer `change_id`, both foreign-keyed to their owner tables.
`github_publications` contains required integer `change_id` as its primary key, required integer `candidate_id` and `validation_run_id` foreign keys, and nullable safe positive integer `pull_request_number`.
Repository identity, branches, pull request URL, and expected commit derive from Change, Candidate, and pull request number.

All cleanup-pending columns are integer Booleans constrained to zero or one.
Task cancellation reason is present exactly when Task state is `cancelled`.
Change cancellation reason is present exactly when `close_reason` is `cancelled`; it is absent for an Open or completed Change.
Task reviewer configuration and Task Reviewer Agent Session are both absent or both present.
Agent Invocation settlement time and kind are both absent or both present, and its five physical token columns are all absent or all present.
A partial unique index permits at most one unresolved Blocker per Change.

Repository Branch and Managed Worktree path are independently unique in Shared Repository State.
A Task Reviewer Agent Session is unique among Tasks.
A Change producer is unique within its Change, and a Change-owned Agent Session is unique in `change_agent_sessions`.
Agent Invocation ID is unique within each domain operation-link table so one Invocation cannot be linked to multiple Task Reviews or multiple Validation phase producers in that owner table.
The Task-to-Change link is unique on both sides.
Application operations enforce Agent Session ownership exclusivity across the separate Task and Change links because SQLite cannot express that cross-table invariant without generic owner data.

All foreign keys use normal `NO ACTION`; immutable product history is not cascade-deleted.
Atomic owner operations enforce cross-table facts that SQLite cannot express locally, including that Validation Run boundaries belong to the Run's Change and that publication Candidate and Validation Run identify the same Change and Candidate.

Beyond primary-key and unique indexes, retain only these operation-backed indexes:

- `tasks (state, id)` for lifecycle-filtered Task listing.
- `task_dependencies (prerequisite_task_id, dependent_task_id)` for reverse dependency reads.
- `task_reviews (task_id, id DESC)` for Task Review history, plus the partial active-Review uniqueness index.
- `changes (close_reason, id)` for Open or Closed Change listing.
- `implementation_decisions (change_id, id)` and `implementation_blockers (change_id, id)` for ordered Change authority history, plus the partial unresolved-Blocker uniqueness index.
- `candidates (change_id, id DESC)` for Candidate history and Current Candidate selection.
- `validation_runs (candidate_id, id DESC)` for Run history, plus partial indexes on the same key where outcome is `NULL` and where outcome is `passed` for Active Run and current passing-evidence reads.
- `agent_continuations (agent_session_id, id DESC)` for current continuation and continuation history.
- `agent_invocations (continuation_id, id)` for Invocation history, plus a partial `(continuation_id)` index where `settled_at IS NULL` for dispatch exclusion and recovery.

Do not add speculative indexes for JSON contents, timestamps, provider, model, or publication fields.

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

## BY-274 acceptance

BY-269 completed the Task and Change coordination boundary, and BY-271 completed the internal numeric identity and operational naming direction described above.
BY-274 is the one remaining direct Change that establishes the final `0001_baseline` and retires the prerelease representation at the release boundary.
BY-274 acceptance is bounded to the exact baseline implementation, verified old bundle, and successful disposable rehearsal.
The BY-274 Change must use the approved final physical model without introducing intermediate persistence migrations or splitting implementation into intermediate Tasks.

The BY-274 acceptance must:

- Build one reviewed `0001_baseline` from the accepted final domain model instead of importing or converting old Shared Repository State.
- Retain working internal code, including current Adapter placement and composition, unless the final schema, removal of a retired representation, or supported behavior requires a change.
- Remove retired prerelease migrations, tables, readers, and compatibility behavior from the released product without reconstructing their records in the new database.
- Preserve the independent SQLite-allocated numeric identities and table-local immutable ordering established by BY-271.
- Preserve the domain `input`, `cacheRead`, `cacheWrite`, `output`, and `total` token evidence and its five physical all-present-or-all-absent columns.
- Preserve independently settled phase results, pre-dispatch phase Invocation links, exactly-once Invocation settlement, correction and recovery Invocations, and their exact token evidence.
- Preserve owner-held cleanup obligations and retryable Terminal Cleanup, exact Candidate and Validation Run agreement for Publication, and exact merged completion through Task and Change coordination.
- Preserve the read-only legacy Reviewer boundary until the old state is archived, then leave legacy records in that archive rather than importing or converting them.
- Preserve Task Reviewer configuration and Change reviewer roster snapshots, including the no-invented-configuration rule for historical legacy records and the fixed configuration required for new Change reviewers.
- Defer Adapter relocation, SQL ownership enforcement, and general cleanup to `post-baseline-hardening.md`.
- Build and verify the exact old executable bundle, record its Git commit and SHA-256, and complete the cutover rehearsal successfully on a disposable repository.

Every BY-274 Task Context must enumerate the required final-schema changes, retired representations, supported behavior changes, and BY-274 acceptance evidence.
If implementation discovers necessary work outside that scope, the Implementer must raise an Implementation Blocker before performing or deferring it.
The Operator decides whether to amend BY-274 or create another bounded Task before acceptance.

BY-274 acceptance does not include the live operator cutover.
After the merged Change is reconciled in the old state, that reconciliation closes the Change and marks the BY-274 Task Done before archive or fresh initialization.
The immediately following live operator cutover is separately authorized, is not a second Task or product feature, and is not a condition of BY-274 Task completion.

## Verification allocation

The BY-274 Change runs the repository's complete required check suite through the owning workflow.
Acceptance verification must establish the final schema inventory, exact ordered baseline ledger behavior, numeric ID and ordering contracts, retained supported behavior, and removal of retired prerelease representations from the released executable.
Acceptance verification must also cover independently settled Validation Phase Results, pre-dispatch and exactly-once Invocation semantics, the `cacheRead` and `cacheWrite` mapping and all five physical token columns, cleanup obligations and retry behavior, exact Candidate and Validation Run Publication agreement, legacy read-only evidence, reviewer configuration snapshots, and operational naming behavior.
Acceptance verification must verify the exact old executable bundle and successful disposable rehearsal.
Live archive, fresh-initialization, and post-reconcile verification are separate operator-cutover evidence and cannot determine BY-274 Task completion.
Do not add verification for importing, converting, or upgrading the retired prerelease database.
Adapter relocation, SQL ownership enforcement, and general cleanup are post-baseline hardening concerns rather than BY-274 acceptance gates.

Real SQLite integration tests verify coordination behavior.
Do not add custom source-scanning tests that duplicate existing architecture checks.

The live operator cutover follows BY-274 acceptance as a separately authorized operation.

## Disposable cutover rehearsal observations

The retained [rehearsal evidence](release-baseline-cutover-rehearsal.json) records the commands, exit statuses, executable identity, archive checks, and persisted observations from the completed disposable run.
The completed disposable rehearsal used an exact old executable bundle built from canonical source commit `10bdce30c94c1d3510b061c7d75f0206328a2494`.
The directly invoked `dist/main.js` entrypoint SHA-256 was `33a6634c750ebc32340463717f5e61b5ce21395633535668fc0a64b71ae6f1cc`, and all 130 files in its runtime manifest verified before reconciliation.
The manifest included the complete `dist` tree, the runtime-required `package.json`, and the source commit record.
The Source Checkout Guard in `bin/by` was not invoked because it can dispatch to a different checkout executable.
The rehearsal reconciled the exact merged disposable Change `BY-C1` by invoking the manifest-covered old runtime directly.
The reconciliation completed the Change, retained complete cleanup, and changed its linked Task from Todo to Done.

The rehearsal archive contained the complete old Git Common Directory But Why state, representative `standards.md` and `verification.md` repository reviewer files, repository and executable identity metadata, inspection instructions, the exact reconciliation output, and SHA-256 manifests.
It also contained the complete manifest-covered old runtime, so its inspection procedure remained usable without the external temporary bundle.
All 139 archived files verified.
The archived SQLite database remained readable with migration ledger entries 1 through 43 and showed the linked Task as Done and the reconciled Change as closed, completed, and fully cleaned up.

Fresh initialization with the release executable produced exactly the 18 approved product tables and migration ledger `[1]` without old Task or Change records.
The before-new-work recovery rehearsal inserted an unknown migration ID, observed read rejection without a state mutation, restored the complete old operational state from the archive copy, and verified both linked `BY-C1` and its Done Task through the manifest-covered old runtime entrypoint.
Fresh initialization then succeeded again.

The after-new-work recovery rehearsal recorded new Task `BY-1`, induced repository identity verification failure, and repaired the new state forward without restoring or merging old state.
The repair preserved `BY-1`, retained exactly the 18 approved product tables and migration ledger `[1]`, and retained no old Change records.
The single archive's checksums still verified after both recovery paths.
The retained active database ended in the repaired fresh baseline state with new Task `BY-1`, migration ledger `[1]`, and no old Change records.

## Prerelease archive

The existing prerelease Shared Repository State remains useful historical evidence but does not need to remain executable by `0.1.0`.
Archive the complete prerelease operational state separately rather than preserving only `state.sqlite`.
The archive preserves the old executable revision and sufficient identity and integrity evidence to inspect the historical state reliably.
It includes the complete Git Common Directory But Why state, repository reviewer files, archive timestamp, repository identity, a SHA-256 manifest, and short instructions for inspecting a copy with the old executable revision.
It needs no special archive format or signature.
The released `by` CLI does not read or import the prerelease archive.

Keep the existing loose SQLite backups until the final prerelease archive is verified.
After verification, remove those loose copies and retain only the new active `state.sqlite` and the single final prerelease archive.

## Separately authorized live operator cutover

This live operation may begin only after BY-274 acceptance, including the verified old bundle and successful disposable rehearsal, is complete.
It is separately authorized after acceptance, is not a second Task or product feature, and does not change the BY-274 completion condition.
Only implementation work required for the direct BY-274 cutover should be recorded in the prerelease database.
Do not record intermediate persistence work or later release work in the old state.
Record Candidate Publication presentation, release reassessment, Global Watcher reassessment, and other post-baseline work only after the live operator cutover succeeds and the new baseline state is active.

### Deferred Candidate Publication presentation Task

After cutover, record a Task to associate each published Change's local Repository Branch with its exact Remote Change Branch through standard Git upstream configuration.
Candidate Publication must establish or repair that association after it verifies the exact remote commit, without another push or any change to Candidate or publication identity.
The behavior must use the configured publication remote, support initial, revised, and already-completed publication, and leave no stale branch configuration after Terminal Cleanup.
It must not write VS Code GitHub Pull Requests extension metadata or depend on that extension's private state.
Verification must use standard Git upstream inspection and confirm that the remote commit is unchanged.

## Retired BY-271 authority

The BY-271-specific `taskPrefix`-compatible Repo Config overlay and Task 7 predecessor language are retired.
The cutover preserves and verifies the unchanged merged `idPrefix` Repo Config and does not install a `taskPrefix` overlay.

The archive preserves old Task and Change history, but the new database does not import or convert it.
The exact ordered live procedure is [Prerelease release-baseline cutover](../docs/tooling.md#prerelease-release-baseline-cutover).
That operator-facing authority governs old-bundle and manifest verification, exact reconciliation, failed and uncertain reconciliation recovery, archive verification, temporary bundle cleanup, fresh initialization, and the before-new-work recovery boundary.
The merged Change reconciliation closes the Change and marks the BY-274 Task Done in old state before archive or fresh initialization.
Live post-reconcile, archive, and fresh-state verification cannot determine BY-274 Task completion because the merged Change was already reconciled and marked Done in old state.
Post-baseline Task recording and plan-removal sequencing may resume only after the complete live procedure succeeds.

Live verification is bounded to archive integrity, old-state SQLite readability, the new baseline migration, repository identity, and basic trusted CLI access.
A fresh clone may be used for initialization as an operational safety convenience, but it is not required.
Do not add product maintenance mode, distributed locking, released rollback, or database conversion for this one-time cutover.

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

The planned BY-274 Change explicitly retires and deletes the prerelease migration files, registration, upgrade tests, and active support after the old state is archived.
Git history and the prerelease archive preserve the old executable revision and migration chain for inspection.
The new database does not import or convert the archived records.
This is an accepted one-time exception to ADR 0009's current consequence that the first release ships the complete prerelease chain.
ADR 0009's governing decision remains applicable: migrations are immutable and schema changes use ordered forward migrations.
After implementation, amend ADR 0009 rather than superseding it.
The amendment records that the prerelease chain was explicitly retired at the first-release boundary, the new `0001_baseline` became the immutable migration root, and normal forward-only migration continues from there.
Do not change current architecture or ADR authority before implementation.

## Live procedure authority

Use [Prerelease release-baseline cutover](../docs/tooling.md#prerelease-release-baseline-cutover) for the exact manual trusted-executable cutover procedure verified during baseline implementation.
Store the old-state inspection instructions in the archive.
Do not add product cutover, rollback, or prerelease conversion commands.

## Authorization status

No baseline implementation, state mutation, archive operation, Task Recording, or cutover is authorized by this plan.
