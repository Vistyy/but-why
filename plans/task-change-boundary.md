# Task and Change boundary plan

**Status:** Approved planning direction.
BY-275 completed the Agent Session design prerequisite for the direct BY-274 baseline.
It is the current Task and Change boundary planning record.
It is not implementation authority.

**Removal condition:** Remove this file after the Operator approves the supported boundaries, the approved implementation outcomes are recorded in the applicable authoritative work systems, and superseded planning records are removed or replaced.

## Purpose

Define strong boundaries between Tasks and Changes while keeping one `by` installation and CLI.
Allow each workflow to be used independently where its own inputs are sufficient, without prematurely creating separate products or executables.

## Current planning position

BY-269 completed the Task and Change coordination direction recorded here, including the durable one-to-one link, coordinated Change Start and cancellation, joined inspection, and exact merged completion in one SQLite transaction.
BY-271 completed the internal Task and Change identity direction, including independent SQLite-allocated numeric IDs, immutable table-local ordering, the frozen repository `idPrefix`, derived public IDs, and Change-owned operational names.
BY-275 completed the Agent Session and Agent Invocation design prerequisite for BY-274.
BY-274 is the one remaining direct baseline cutover.
It establishes the final schema without importing or converting old data, retains working internal code unless the final schema, a retired representation, or supported behavior requires a change, and defers Adapter relocation, SQL ownership, and general cleanup to `post-baseline-hardening.md`.
This file remains a plan for the accepted boundary and does not become current implementation authority.

## Accepted planning direction

Keep a modular monolith with three domain areas: Tasks, Changes, and Repository Runtime.
Task and Change coordination is an application boundary, not another domain.

Tasks own:

- Task recording and editing.
- Task Dependencies and readiness.
- Exact-proposal Task Review and approval.
- Task Lifecycle.
- Supplying exact approved intent when starting a Change.
- Task Lifecycle rules applied during coordinated completion.

Changes own:

- Durable retention of optional Acceptance Context.
- Change implementation and its Managed Worktree.
- Herdr and Pi Interactive Sessions.
- Implementation Decisions.
- Implementation Blockers and Resolutions.
- Acceptance Context versions used during the Change.
- Candidate identity and Validation Runs.
- Candidate Publication and merge reconciliation.
- Durable completed-delivery evidence.

Task and Change coordination owns moving approved Task intent into a Change, completing the corresponding Task from sufficient Change evidence, coordinating cancellation, and joining Task and Change projections for CLI output.
It must use the supported Task and Change interfaces instead of direct cross-module reads or duplicated lifecycle policy.
Repository Runtime continues to own repository identity, shared database access, configuration, preparation, and executable selection.

The built-in Implementer continues to commit in one persistent Managed Worktree and invoke Change Submission through the `by` CLI.
A later Candidate for the same Change is another immutable committed state from that same implementation lineage, not another Managed Worktree.

The first supported coordinated workflow may retain one approved implementation Task to one Change.
The boundary change does not introduce multiple-Change Tasks, generic completion policies, arbitrary lifecycle hooks, a plugin system, a separate composition service, or a persistent orchestrator.

## Current coupling trace

This trace records current behavior that the boundary change must replace or preserve.
It does not select the replacement interface.

### Change Start

`by change start --task <task-id>` parses a repository-specific Task ID and uses it as a Change authority input.
Change Start:

1. Reads the Task from Shared Repository State.
2. Requires Task state `todo`.
3. Requires every direct Task Dependency to be Done.
4. Finds and resumes the existing Change for that Task when present.
5. Rejects a requested Change Base that conflicts with that existing Change.
6. Repeats Task eligibility and one-Change-per-Task checks in the Change creation transaction.
7. Copies Task title and description into Acceptance Context version 1.
8. Inserts the Change with its Task relationship.

The main implementation owners are:

- `src/change/changeLifecycle.ts`.
- `src/change/changeStartPersistence.ts`.
- `src/change/changeStartStore.ts`.
- `src/sqlite/sqliteChangeStartPersistence.ts`.
- `src/cli/change/start.ts`.
- `src/cli/change/lifecycleResults.ts`.

The current schema makes `changes.task_id` unique and foreign-keyed to `tasks.id`.
It requires Task ID and Acceptance Context to be present or absent together.
Change read paths enforce the same relationship and reject a linked Change whose Task no longer exists.

Task identity also determines the Repository Branch, Managed Worktree, Herdr session name, and Pi agent session title for a Change linked to a Task.
These naming dependencies are implemented through `src/task/taskId.ts`, `src/change/changeLifecycle.ts`, and `src/change/interactiveSession/launchInteractiveImplementer.ts`.

### Interactive implementation and authority

`by change implement` requires an open Change and launches Herdr and Pi in the existing Managed Worktree.
The initial prompt contains Change identity, Managed Worktree path, preparation failure evidence when present, and an optional non-authoritative Implementer Prompt.
It does not directly include Acceptance Context.
Packaged Implementer guidance tells the agent to inspect intent through CLI commands.

The `continue-change` extension binds itself to the Change ID and drives repeated inspection and Submission.
Most of its state is Change-owned, but its reassessment path for a Change linked to a Task currently invokes `by task context <task-id>` and treats that live read as required evidence.
The Task Context read joins Change-owned Blocker Resolutions through `changes.task_id`.
This is a direct runtime Task dependency that must be replaced by Change-owned Acceptance Context inspection.

The applicable implementation owners are:

- `src/change/interactiveSession/implementerPrompt.ts`.
- `src/change/interactiveSession/launchInteractiveImplementer.ts`.
- `src/change/interactiveSession/adapters/herdrInteractiveSessionHost.ts`.
- `extensions/continue-change.ts`.
- `docs/public/skills/but-why/references/implement-change.md`.
- `docs/public/skills/but-why/references/operator-workflow.md`.

Implementation Decisions, Implementation Blockers, and their Resolutions are already Change-owned.
Storage permits at most one unresolved Blocker for a Change.
Resolving a Blocker appends its content to the Change Acceptance Context only when the Change has both a Task ID and Acceptance Context.
The boundary change must make this behavior depend only on Change-owned Acceptance Context.

The Change retains its immutable initial Acceptance Context, and each approved Resolution remains on its Implementation Blocker.
The current Acceptance Context is derived by applying those ordered Resolutions rather than updating a second stored copy.
Each Validation Run retains the exact resulting Acceptance Context it used in its immutable Validation Policy Snapshot.

### Candidate selection, validation, and Acceptance Review

After Change Start, Candidate selection, Submission, Validation, and Acceptance Review do not query Task tables.
They use the Acceptance Context captured on the Change.

Candidate selection records the exact Change, fetched Change Base commit, and Repository Branch head commit.
Validation start currently copies the current Change Acceptance Context into the Validation Policy Snapshot and records the exact Candidate, Implementation Decisions, Blocker history, and latest resolved Blocker identity required by current validation rules.
The replacement baseline stores the highest included Decision and Blocker IDs; because Blockers cannot overlap and Validation cannot start with an unresolved Blocker, the highest included Blocker also identifies the latest Resolution.
The Acceptance Reviewer receives that copied Acceptance Context with the Candidate, Decisions, Blocker history, prior Findings, and Artifact references.
Validation Run inspection exposes the retained policy snapshot.

The main implementation owners are:

- `src/change/candidateCapture/`.
- `src/change/candidateValidation/`.
- `src/change/acceptanceReview/`.
- `src/change/validationRun/`.
- `src/sqlite/sqliteCandidateValidationExecutionPersistence.ts`.
- `src/cli/validationRunViews.ts`.

This existing snapshot chain can prove which Acceptance Context the Acceptance Reviewer received without reading live Task Context during Validation.

### Candidate Publication and presentation

Current Candidate Publication does not query Task tables.
For a Change with a Task ID, it uses the captured Acceptance Context title as the pull request title and renders the Task ID in the pull request body.
Publication otherwise relies on exact Candidate, passing Validation Run, remote branch, and owned pull request facts.

The paused Candidate Publication presentation plan proposed reading Task Review history during presentation generation.
That proposed live dependency is not part of the implemented system and must not carry into the extracted boundary without a new accepted requirement.

The applicable owners are:

- `src/change/publication/candidatePublication.ts`.
- `src/sqlite/sqliteCandidatePublicationPersistence.ts`.
- `plans/candidate-publication-presentation.md`.

### Cancellation

Task and Change cancellation currently form one coordinated workflow.
Task cancellation finds a linked Change and routes through Change cancellation under the Change Submission lock.
Change cancellation rejects an Active Validation Run, reconciles an exactly merged owned pull request to completion, closes an open owned pull request when required, and then atomically closes the Change and cancels its linked Task.

The main implementation owners are:

- `src/change/cancelChange.ts`.
- `src/sqlite/sqliteChangeCancellationPersistence.ts`.
- `src/cli/task/commands/cancel.ts`.
- The Change cancellation CLI modules.

After the boundary change, Change cancellation must not mutate Task state through Change persistence.
Cancelling either a linked Task or linked Change invokes the same coordinated operation.
An Active Validation Run rejects cancellation without state changes.
An exact merged Candidate completes the Change and Task instead.
Otherwise, coordination closes the owned pull request when required, then atomically cancels the Change and Task.
If the pull request closes but the database update fails, coordination reports incomplete cancellation.
A retry confirms that the pull request is already closed before atomically cancelling the Change and Task.
Terminal Cleanup remains a later Change-owned operation.

### Merge reconciliation and completion

Submission, explicit reconciliation, and cancellation can all observe an exact merged Candidate and invoke the same completion operation.
That operation verifies the observed repository, base branch, head branch, expected head commit, pull request, Candidate, and Validation Run against current publication.
It then atomically:

1. Closes the Change as completed.
2. Marks Change cleanup pending.
3. Marks the linked Task Done.

The operation is idempotent when the Change is already completed.
Terminal Cleanup runs afterward as a separate retryable Change-owned operation.

The main implementation owners are:

- `src/sqlite/sqliteCompleteMergedChangeStorage.ts`.
- `src/change/submitChange.ts`.
- `src/change/reconcileChange.ts`.
- `src/change/cancelChange.ts`.
- `src/change/cleanupTerminalChange.ts`.

The replacement boundary must preserve this atomic guarantee for the built-in SQLite workflow while moving its ownership from Change persistence to Task and Change coordination.

### Inspection and public interfaces

Task inspection currently projects linked Change activity as implementing, validating, blocked, or ready.
The planned modular boundary preserves a combined Task inspection view through Task and Change coordination.
Coordination reads supported Task and Change projections and joins them for output without storing Change state on the Task or putting Change rules in Tasks.
Change and Validation Run output expose Task ID.
Change Start errors and recovery guidance refer to Task state, Task Review, dependencies, and Task cancellation.
The continuation extension parses these structured results.

The affected interface owners include:

- `src/change/inspectChange.ts`.
- `src/cli/task/`.
- `src/cli/change/`.
- `src/cli/validationRunViews.ts`.
- `src/cliCommandTree.ts`.
- `extensions/continue-change.ts`.
- Packaged public documentation and skills under `docs/public/`.

These are public contracts, not only implementation imports.
The boundary change must replace the complete supported interface in the same change as its parsers and packaged instructions.

Public Change inspection must expose the complete current Change-owned Acceptance Context as its version, title, description, optional comments, and ordered approved Resolutions.
The `continue-change` extension must use that Change output and must not read live Task Context.
Change-only, Candidate, and Validation Run inspection must not expose Task ID.
The joined Task inspection projection and coordinated start, cancellation, and completion results may expose both identities because Task and Change coordination owns those views.
Publication presentation must not expose Task ID.

### Persistence and runtime inventory

Task-owned persistence includes Tasks, Task Dependencies, Task Reviews, Task Review Findings, Task Reviewer Sessions, Task Reviewer Transcripts, and their execution evidence.
Cross-domain persistence includes the Task foreign key on Change, one-Change-per-Task uniqueness, paired Task and Acceptance Context constraints, Change Start eligibility reads, cancellation, completion, and Task projections.

Task Review also depends on infrastructure currently shared with Change Delivery:

- Repository identity and Shared Repository State opening.
- Pi reviewer execution.
- Reviewer Session execution and transcript discovery.
- Agent Profile resolution.
- Repository Preparation.
- Disposable exact-commit workspaces.
- Structured CLI output.

The completed BY-269, BY-271, and BY-275 work supplies the ownership, identity, and Agent Session direction for the final `0001_baseline`.
BY-274 acceptance is limited to the exact baseline implementation, verified old bundle, and successful disposable rehearsal.
The remaining live operator cutover is separately authorized after acceptance and does not create a second Task or product feature.
Merged Change reconciliation closes the Change and marks the BY-274 Task Done in old state before archive or fresh initialization, so live post-reconcile verification is not a Task completion condition.
The live pause, reconciliation, archive, fresh-init, and recovery sequence must complete successfully before post-baseline sequencing resumes.
The remaining BY-274 cutover does not import or convert old data and does not require intermediate persistence migrations or dual runtime compatibility.
Working internal code remains in place unless the final schema, retired representation removal, or supported behavior requires a change.
The cutover removes the retired prerelease representation from the released product and preserves its historical evidence only in the operational archive.

### Verification inventory

The current coupling is materially exercised by:

- Change Start and Managed Worktree tests.
- Interactive implementation and `continue-change` extension tests.
- Acceptance Review and Candidate Validation policy tests.
- Candidate Publication policy tests.
- Change cancellation and reconciliation tests.
- Change and Task inspection tests.
- SQLite decoding, constraint, and migration tests.
- Package-content and portable-skill tests.

The baseline cutover must preserve these supported independent and coordinated interfaces rather than merely delete the coupled tests.

## Required boundaries

### Starting a Change from a Task

Task and Change coordination asks Tasks for the exact approved Task Context and passes its complete title and description to Change Start through an internal typed operation.
Change Start stores that content as the initial Acceptance Context while the same coordination transaction records the Task-to-Change link.

Tasks own Task Review, approval, readiness, and the exact context eligible to start a Change.
Changes do not independently review Task intent or reinterpret Task readiness.
After Change Start, implementation and validation read the Change-owned Acceptance Context rather than mutable live Task Context.
Validation Policy Snapshots retain the exact complete Acceptance Context used by each Validation Run.

The initial boundary has no portable transfer artifact, compatibility envelope, digest, Intent Reference, approval signature, or external approval claim.
A future external Task backend must justify any additional boundary contract when it becomes supported.

Repeated Change Start for a Task returns its existing linked Change.
A requested Change Base that conflicts with the existing Change is rejected.
When no link exists, coordination atomically rechecks Task eligibility, starts the Change, and records the link.
This behavior needs no separate request identifier or retry protocol.

### Change-owned authority after Change Start

The initial Acceptance Context and approved Change-owned Resolutions are authoritative for that Change.
Validation must use the exact current Acceptance Context version retained by Changes and must not read mutable live Task content.

A Task link always requires the Change to retain the approved Task intent as initial Acceptance Context.
A Change without a Task has no Acceptance Context and validates existing committed work without implementation intent.
The first release has no independent authority or input path for supplying Acceptance Context without a Task; a future accepted interface may add one.
Tasks and Changes use independent SQLite-allocated table-local integer identities.
Shared Repository State freezes the repository ID Prefix at initialization.
The application derives public Task IDs as `<id-prefix>-<task-number>` and public Change IDs as `<id-prefix>-C<change-number>`, such as `BW-17` and `BW-C8`.
Internal relationships use integer foreign keys and do not store duplicated public ID strings or UUIDs.
Opening Shared Repository State rejects a configured `idPrefix` that conflicts with its frozen repository ID Prefix.
A linked Change does not reuse its Task ID.
Change-owned branch names, worktree paths, machine session names, output, and publication use the Change ID rather than Task ID.
Human-facing Herdr and Pi titles may add the Change-owned Acceptance Context title, such as `BW-C17 Fix login timeout`.
A Change without Acceptance Context uses its Change ID alone.
Joined Task and Change views remain the place that exposes the Task link.

The planned validation matrix is:

- Without Acceptance Context or Specialist Reviewers, run configured Checks only.
- Without Acceptance Context but with Specialist Reviewers, run configured Checks and Specialist Reviews.
- With Acceptance Context, run configured Checks and Acceptance Review, plus any configured Specialist Reviews.

Accepted planning direction:

- Use “Change linked to a Task” and “Change without a Task.”
  Do not introduce categorical names for these cases.
- **Resolved planning direction:** Tasks approve the initial Task intent used to start the Change.
  During implementation, the Operator may approve a Blocker Resolution that amends the Change-owned Acceptance Context.
  Changes retain the initial Acceptance Context and the Resolution lineage so delivery evidence does not imply that Task Review approved later amendments.
  The first boundary change does not write those Resolutions back to the Task.
  Later Task and Change coordination may surface them to Tasks without making that behavior part of initial Change execution.
- **Resolved planning direction:** At Validation Run start, the complete current Acceptance Context is stored in the immutable Validation Policy Snapshot.
  The Acceptance Reviewer input is built from that retained content.
  The existing `version: 1` identifies the stored format rather than a separate Acceptance Context revision.
  No digest or separate revision identifier is required.

### Coordinated completion

Changes own verification and durable retention of the exact repository, Candidate, Validation Run, publication, pull request, and merge facts required to complete a Change.
Task and Change coordination owns the rule that completing an exactly merged linked Change marks its Task Done in the same built-in SQLite transaction.
Tasks own the resulting Task Lifecycle transition.
For an exact merged linked Change, Task and Change operations ask Tasks to apply their lifecycle rule inside the coordinated transaction.
A `todo` Task becomes `done`, an already `done` Task remains unchanged, and a `new` or `cancelled` Task rejects the complete operation without changing either record.
Change Submission and reconciliation receive one narrow exact-merged completion operation.
Composition supplies an implementation that checks the link and completes either the Change alone or the Change and linked Task atomically, so Changes do not import Task and Change operations.
No portable receipt or external evidence-verification contract is part of the initial boundary.

Task and Change coordination owns one durable relationship for the built-in workflow: the exact Task linked to the exact Change.
A coordination-owned link table enforces the first supported one-Task-to-one-Change rule and supports combined inspection and atomic coordination.
It stores only the internal integer Task and Change foreign keys and does not copy public IDs, Task Lifecycle, Change state, Acceptance Context, Validation, or publication facts.

Repository Runtime provides the SQLite transaction capability without knowing Task or Change operations.
Task and Change composition connects narrow transaction-bound Task, Change, and link Adapters inside one transaction for Change Start, coordinated cancellation, and exact merged completion.
The workflow calls those narrow operations without receiving raw SQL or concrete Adapters.
Each Adapter accesses only its owner's tables, and any failure rolls back the complete coordinated update.
The current Adapters that open their own transactions must be split into transaction wrappers and transaction-bound operations where coordination requires them.
A future external Task backend must define its own completion and recovery contract when that backend becomes supported.

## Boundary cleanup

The Change boundary should not own or interpret:

- Task Lifecycle states.
- Task Dependencies or readiness.
- Task Review lifecycle or approval policy.
- Task creation or revision.
- Task eligibility for Change Start.
- Task projections derived from Change state.

Task cancellation and completion effects must occur through Task and Change coordination rather than hidden Change persistence behavior.
Changes retain the complete initial Acceptance Context as validation authority.
Coordination owns Task-to-Change correlation.

The cleanup inventory must cover implementation, persistence, migrations, CLI commands, output, configuration, packaged instructions, public documentation, tests, operational names, and generated artifacts.

## Module boundary

Do not treat the boundary change as moving `src/task/` alone.
Place cross-domain application operations under `src/taskChange/` without naming a generic coordination service.
BY-274 does not require moving working owner-specific SQLite Adapters from the flat `src/sqlite/` area.
Adapter relocation, SQL ownership enforcement, and general cleanup are deferred to `post-baseline-hardening.md`, where their final scope and verification can be bounded against the baseline.
Keep shared database lifecycle and immutable ordered migrations under Repository Runtime.
Tasks and Changes currently share repository and agent infrastructure.
The design must inspect ownership of:

- Repository identity and initialization.
- SQLite runtime and migrations.
- Pi reviewer execution.
- Reviewer Sessions and transcripts.
- Agent Profile resolution.
- Repository Preparation.
- Disposable exact-commit workspaces.
- Structured CLI output and packaged instructions.

For each shared mechanism, keep it with its existing coherent owner or define the narrowest common mechanism justified by both current consumers.
Do not create a broad shared framework merely to prevent small duplication.

Shared agent infrastructure uses the planned Agent Session and Agent Invocation concepts rather than preserving Reviewer Session as the general name or adding a generic Agent Execution record.
It owns harness invocation and continuation, invocation settlement evidence, transcript discovery, and harness-specific usage extraction.
Tasks and Changes retain ownership of agent roles, instructions, supplied authority, structured-result interpretation, Findings, lifecycle effects, and recovery decisions.
A Review remains a Task- or Change-owned use of Agent infrastructure rather than a shared Agent-infrastructure domain concept.
The visible Implementer session remains separate from shared headless Agent Invocation.
Changes own implementation behavior, and `InteractiveSessionHost` owns Herdr launching.
Exact-commit disposable Snapshot Workspaces remain shared infrastructure behind a narrow workspace interface used by Task Review and Change Validation.
They remain separate from the Change-owned persistent Managed Worktree.
Repository Runtime reads repository and global configuration, including the configured Repository Preparation command.
Shared Repository Preparation executes that command through a narrow interface.
Tasks and Changes decide when preparation is required and how its failure affects their workflows.
The current configurable Task Prefix becomes the repository ID Prefix used to derive both Task and Change public IDs.
Repository initialization stores it in Shared Repository State, where it remains immutable for that repository.
Because But Why is unreleased, the first-release configuration uses only `idPrefix`, rejects conflict with initialized state, and provides no `taskPrefix` compatibility behavior.
Tasks and Changes select and store the resolved Agent Profile required by their reviewer policy.
A Task stores its resolved Task Reviewer configuration when its Task Reviewer Agent Session first launches.
A Change fixes its reviewer roster and stores all resolved role configurations at Change Start, even though their Agent Sessions are created lazily.
The approved no-conversation `launch_failed` correction may replace only the affected owner-role configuration and never changes the Change roster.
After a conversation is established, later Repo or Global Config changes do not alter that stored owner-role configuration.
Agent infrastructure applies the stored profile as the exact Pi model, tools, skills, extensions, and runtime settings.

Tasks, Changes, and Task and Change operations define their own result data.
The shared output module only validates and serializes structured JSON.
CLI modules only map commands to supported operations and their results.
Public output may retain lifecycle fields derived from authoritative owner data: Change derives `open` or `closed` from its close reason, and Task Review and Validation Run derive `active` or `complete` from nullable outcome.
Public histories use immutable integer order and do not retain creation, update, closure, or age fields whose source timestamps are removed.
Task Review and Validation Run inspection expose exact Agent Invocation evidence and join their owner's effective reviewer configuration without copying it into the Review or Run.
Snapshot Workspace inspection may expose its deterministic derived path together with cleanup evidence even though the path is not stored.

The existing `by change start` command remains one command.
With `--task`, it selects Task and Change coordination.
Without `--task`, it selects Changes directly.
Both existing cancellation commands select coordination because the relationship must be read from storage.
Coordination performs linked cancellation when a link exists and otherwise calls only the owning domain operation.
The CLI selects the supported operation but does not perform coordination itself.

Fallow must enforce the module dependency graph, including these rules:

- Tasks and Changes do not import each other.
- Coordination depends only on narrow Task and Change operations for starting, completion, cancellation, and supported projections.
- Coordination cannot access whole domain stores, unrelated persistence methods, or raw SQL.
- Domain modules do not import CLI, composition, or concrete Adapters.
- Task and Change SQLite Adapters access only their owner's tables.
- Coordination SQLite Adapters access only the Task-to-Change link table.
- Repository Runtime owns the shared database and transaction capability without importing Tasks or Changes.
- Task and Change composition connects transaction-bound owner Adapters; the workflow receives only their narrow operations.
- Repository Runtime remains the owner of the shared database lifecycle and repository-scoped runtime capabilities.

Real SQLite behavior tests must verify atomic Change Start, completion, cancellation, and rollback through the supported coordination operations.
BY-274 does not move Adapters or add SQL ownership enforcement.
After the baseline, verify any retained table-ownership rule through the final owner placement, targeted search, and review.
Do not add an ast-grep rule that guesses table ownership from SQL strings.
Add a durable SQL ownership checker only if post-baseline evidence shows recurring violations that justify its maintenance cost.

## Independent and coordinated verification

The boundary is sufficient only when all of these paths are practical through one `by` installation:

1. Tasks can be recorded, reviewed, approved, revised, inspected, and cancelled without starting a Change.
   An unlinked Task cannot become Done; Done requires exact merged completion of its linked Change.
2. Existing committed work can be validated and published through a Change without a Task or Acceptance Context.
3. An approved Task can start a Change with its exact intent, and the Acceptance Reviewer receives the exact retained Acceptance Context version.
4. One Managed Worktree produces a Candidate, receives Findings, produces a later Candidate, and submits again through the existing Interactive Session loop.
5. Task and Change coordination evaluates completed-delivery evidence and completes the corresponding implementation Task idempotently.
6. Built-in exact merged completion updates the Change and linked Task atomically.

## Planning sequence

1. **Complete:** Trace the current Task-to-Change coupling through Change Start, implementation, Submission, cancellation, reconciliation, presentation, cleanup, and Task inspection.
2. **Complete:** Define and review starting a Change from a Task.
3. **Complete:** Define and review Change-owned authority after Change Start.
4. **Complete:** Define and review coordinated Task and Change completion.
5. **Complete:** Inventory shared infrastructure and define the module dependency rules.
6. **Complete (BY-275):** BY-275 completed the Agent Session and Agent Invocation design prerequisite for the first-release database baseline.
7. **Remaining (BY-274):** Complete the exact first-release baseline implementation, verified old bundle, and successful disposable rehearsal, then separately authorize the live operator cutover.
   Do not import or convert old data, add intermediate persistence migrations, or move working internal code unless the final schema, retired representation removal, or supported behavior requires it.
   Candidate Publication presentation remains deferred and adds any later storage through a normal post-baseline migration.
8. Reassess the release and Global Watcher plans against the accepted boundary.
9. Remove superseded plans and record only still-supported outcomes in replacement plans or authoritative work records.

## Decisions deferred

- Unifying the Change evidence supplied to Acceptance and Specialist Reviewers while preserving their different review responsibilities.
  The baseline already retains Acceptance Context, Implementation Decisions, Blocker history, Findings, and Artifacts, so this later reviewer-input change requires no baseline storage generalization.
- Additional Task backends.
- Separate products, executables, or repositories.
- Generic hooks or a separate orchestration service.
- Multiple Changes per Task.
- Task kinds and configurable completion policies.
- Surfacing Change-owned Blocker Resolutions back to Tasks.
- Splitting implementation workspace behavior from But Why.

## Authorization status

This plan records exploration and the current direction only.
It does not authorize implementation, Task Recording, Task Submission, Change Start, publication, repository creation, package creation, or external configuration.
