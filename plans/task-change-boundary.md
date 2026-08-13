# Task and Change boundary plan

**Status:** Active exploration.
It is the only current product-boundary planning record.
It is not implementation authority.

**Removal condition:** Remove this file after the Operator approves the supported boundaries, the approved implementation outcomes are recorded in the applicable authoritative work systems, and superseded planning records are removed or replaced.

## Purpose

Define strong boundaries between Tasks and Changes while keeping one `by` installation and CLI.
Allow each workflow to be used independently where its own inputs are sufficient, without prematurely creating separate products or executables.

## Accepted planning direction

Keep a modular monolith with three explicit areas: Tasks, Changes, and Task and Change coordination.

Tasks own:

- Task recording and editing.
- Task Dependencies and readiness.
- Exact-proposal Task Review and approval.
- Task Lifecycle.
- Handoff of exact approved intent.
- Acceptance of sufficient completion evidence under Task rules.

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

Task and Change coordination owns moving approved Task intent into a Change and completing the corresponding Task from sufficient Change evidence.
It must use the supported Task and Change interfaces instead of direct cross-module reads or duplicated lifecycle policy.

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

Task identity also determines the Repository Branch, Managed Worktree, Herdr session name, and Pi agent session title for a Task-backed Change.
These naming dependencies are implemented through `src/task/taskId.ts`, `src/change/changeLifecycle.ts`, and `src/change/interactiveSession/launchInteractiveImplementer.ts`.

### Interactive implementation and authority

`by change implement` requires an open Change and launches Herdr and Pi in the existing Managed Worktree.
The initial prompt contains Change identity, Managed Worktree path, preparation failure evidence when present, and an optional non-authoritative Implementer Prompt.
It does not directly include Acceptance Context.
Packaged Implementer guidance tells the agent to inspect intent through CLI commands.

The `continue-change` extension binds itself to the Change ID and drives repeated inspection and Submission.
Most of its state is Change-owned, but its reassessment path for a Task-backed Change currently invokes `by task context <task-id>` and treats that live read as required evidence.
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

The current `changes.acceptance_context` value is updated in place.
Each Validation Run retains the exact Acceptance Context it used in its immutable Validation Policy Snapshot.

### Candidate selection, validation, and Acceptance Review

After Change Start, Candidate selection, Submission, Validation, and Acceptance Review do not query Task tables.
They use the Acceptance Context captured on the Change.

Candidate selection records the exact Change, fetched Change Base commit, and Repository Branch head commit.
Validation start copies the current Change Acceptance Context into the Validation Policy Snapshot and records the exact Candidate, Implementation Decisions, Blocker history, and latest resolved Blocker identity required by current validation rules.
The Acceptance Reviewer receives that copied Acceptance Context with the Candidate, Decisions, Blocker history, prior Findings, and Artifact references.
Validation Run inspection exposes the retained policy snapshot.

The main implementation owners are:

- `src/change/candidateCapture/`.
- `src/change/candidateValidation/`.
- `src/change/acceptanceReview/`.
- `src/change/validationRun/`.
- `src/sqlite/sqliteCandidateValidationExecutionPersistence.ts`.
- `src/cli/validationRunViews.ts`.

This existing snapshot chain can prove which Acceptance Context the Acceptance Reviewer received without reading a live external Task during Validation.

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
Task and Change coordination may request both supported cancellation operations and must report any partial result.

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

This is the principal cross-boundary atomic guarantee under review.
The replacement boundary must preserve exact merged-Candidate evidence and idempotence.
It must also support visible incomplete coordination and safe retry when the selected Task backend cannot share the local transaction.

### Inspection and public interfaces

Task inspection currently projects linked Change activity as implementing, validating, blocked, or ready.
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

These are product contracts, not only implementation imports.
The boundary change must replace the complete supported interface in the same change as its parsers and packaged instructions.

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

The boundary change must preserve immutable migration history until the release-baseline decision explicitly establishes another accepted cutover rule.
Existing migration files are evidence and are not edited as a boundary shortcut.

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

The migration plan must replace these claims through supported standalone and composed interfaces rather than merely delete the coupled tests.

## Required boundaries

### Acceptance Context handoff

Define the smallest versioned input that identifies which exact supplied intent But Why received.
The handoff must contain the complete authority needed by the Implementer and Acceptance Reviewer without requiring But Why to query live Task state.

Tasks own Task Review and approval.
The supported Task handoff must provide the exact approved Task proposal.
Changes do not independently review that proposal or reinterpret Task readiness.
The Change boundary validates only the supported input contract and proves which exact Acceptance Context it retained and used.

This preserves a one-way authority handoff inside the modular monolith and supports the same contract for a future external Task backend.
A rejected handoff means that the input contract is unsupported or malformed, not that Changes disagree with the intent or require Task revision.

The first handoff format has this planned shape:

```json
{
  "version": 1,
  "acceptanceContext": {
    "title": "Add authentication",
    "description": "Users must sign in before..."
  },
  "intentReference": "https://github.com/acme/widget/issues/87"
}
```

The planned responsibilities are:

- `version` selects the handoff schema and compatibility rules.
- `acceptanceContext` is a closed, validated schema containing the complete title and description used by implementation, validation, and presentation.
- `intentReference` is optional for Change use without a Task and present when a Change begins from an approved Task.
  It is one immutable, opaque reference that identifies the intent record in its Task backend, such as a Task ID, URL, or URN.
  Changes store and echo it for definite lifecycle correlation without parsing it, querying its backend, treating it as approval evidence, or using it as semantic intent content.
- Changes calculate and retain an Acceptance Context digest from the exact validated Acceptance Context they store.
  The caller does not supply the authoritative digest.
  The digest identifies exact content and does not prove external approval.
- Unknown properties or values outside the selected schema are rejected as unsupported or malformed input.

Still resolve:

- The canonical digest representation and algorithm contract.
- Import idempotence and conflict behavior.

### Change-owned authority after import

Define the authority retained by But Why after import.
The current direction is that the imported Acceptance Context and approved Change-owned Resolutions are authoritative for that Change.
Validation must use the exact current Acceptance Context version retained by But Why and must not read mutable live Task content.

Acceptance Context remains optional so But Why can validate existing committed work without implementation intent.
The planned validation matrix is:

- Without Acceptance Context or Specialist Reviewers, run configured Checks only.
- Without Acceptance Context but with Specialist Reviewers, run configured Checks and Specialist Reviews.
- With Acceptance Context, run configured Checks and Acceptance Review, plus any configured Specialist Reviews.
- Intent Reference is permitted only when Acceptance Context is present.

Still resolve:

- How the optional Intent Reference is stored and exposed without importing the Task domain.
- Which current Task-backed and taskless terms are retired or renamed.
- **Resolved planning direction:** Tasks approve the initial handed-off intent.
  During implementation, the Operator may approve a Blocker Resolution that amends the Change-owned Acceptance Context.
  Changes retain the initial Acceptance Context and the Resolution lineage so delivery evidence does not imply that Task Review approved later amendments.
  The first boundary change does not write those Resolutions back to the Task.
  Later Task and Change coordination may surface them to Tasks without making that behavior part of initial Change execution.
- How the Validation Policy Snapshot proves which Acceptance Context the Acceptance Reviewer received.

### Completed-delivery evidence

Define the smallest durable Change result that Task and Change coordination can evaluate before completing the corresponding Task.
Tasks must own the Task transition and must not accept an arbitrary caller assertion that work is complete.

Resolve at least:

- Exact repository, Change, Candidate, Validation Run, publication, and merge facts included in the evidence.
- Binding to the exact imported Acceptance Context digest and any retained Intent Reference.
- Whether coordination verifies evidence through a live Change inspection operation, a portable receipt, or another bounded mechanism.
- Idempotent completion and reconciliation after an uncertain external mutation.
- The first supported one-Task-to-one-Change completion rule.

A future external Task backend cannot share one SQLite transaction with Changes.
The supported boundary must therefore define deterministic, idempotent completion that can make an incomplete second mutation detectable and safely retryable.
Whether the built-in SQLite Task backend retains a stronger local atomic operation remains unresolved.

## Boundary cleanup

The Change boundary should not own or interpret:

- Task Lifecycle states.
- Task Dependencies or readiness.
- Task Review lifecycle or approval policy.
- Task creation or revision.
- Task eligibility for Change Start.
- Task projections derived from Change state.

Task cancellation and completion effects must occur through Task and Change coordination rather than hidden Change persistence behavior.
Changes may retain an opaque Intent Reference and the complete handed-off Acceptance Context as correlation and validation authority.

The cleanup inventory must cover implementation, persistence, migrations, CLI commands, output, configuration, packaged instructions, public documentation, tests, operational names, and generated artifacts.

## Module boundary

Do not treat the boundary change as moving `src/task/` alone.
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
Architecture checks must reject direct imports that bypass the supported Task, Change, or coordination interface.

## Independent and coordinated verification

The boundary is sufficient only when all of these paths are practical through one `by` installation:

1. Tasks can be recorded, reviewed, approved, inspected, and completed without starting a Change.
2. Existing committed work can be validated and published through a Change without a Task or Acceptance Context.
3. An approved Task can hand off its exact intent and the Acceptance Reviewer receives the exact retained Acceptance Context version.
4. One Managed Worktree produces a Candidate, receives Findings, produces a later Candidate, and submits again through the existing Interactive Session loop.
5. Task and Change coordination evaluates completed-delivery evidence and completes the corresponding implementation Task idempotently.
6. A failure between Change completion and Task completion is visible and safely retryable.

## Planning sequence

1. **Complete:** Trace the current Task-to-Change coupling through Change Start, implementation, Submission, cancellation, reconciliation, presentation, cleanup, and Task inspection.
2. **In progress:** Define and review the Acceptance Context handoff.
3. Define and review Change-owned authority after import.
4. Define and review completed-delivery evidence and Task completion.
5. Inventory shared infrastructure and define the module dependency rules.
6. Define staged migration and verification without preserving retired cross-boundary behavior.
7. Reassess the paused Agent Session, Candidate Publication, baseline, release, and Global Watcher plans against the accepted boundary.
8. Remove superseded plans and record only still-supported outcomes in replacement plans or authoritative work records.

## Decisions deferred

- Additional Task backends.
- Separate products, executables, or repositories.
- Generic hooks or a separate orchestration service.
- Multiple Changes per Task.
- Task kinds and configurable completion policies.
- Cross-product revision of approved intent after an Implementation Blocker.
- Splitting implementation workspace behavior from But Why.

## Authorization status

This plan records exploration and the current direction only.
It does not authorize implementation, Task Recording, Task Submission, Change Start, publication, repository creation, package creation, or external configuration.
