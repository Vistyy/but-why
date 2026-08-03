---
status: approved-direction-targets-provisional
artifact_kind: working-plan
remove_when: every candidate has an authoritative disposition, accepted simplification work is complete, and retained behavior is recorded in approved Tasks and applicable current documentation
---

# Codebase simplification audit

> Non-authoritative working plan.
> This file records the accepted audit direction and current simplification candidates.
> It does not authorize implementation or describe current product behavior.

## Outcome

But Why should contain only behavior, safeguards, abstractions, compatibility paths, and evidence that protect an accepted current outcome or answer a concrete observed failure.
The audit must prefer deletion and direct ownership over generic mechanisms, duplicated state, speculative compatibility, and provider leakage.

## Entry condition and sequence

The previous requirement to complete broad verification portfolio migration before product simplification is superseded.
Refresh verification portfolio design early so it states the target risks and ownership boundaries.
Implement approved lifecycle and codebase simplifications with focused Task Verification Contracts before broad portfolio migration would encode obsolete structure.
Execute broad portfolio migration only after the important ownership seams stabilize.

Use this sequence:

1. Complete the system-wide minimal-constraint review.
2. Refresh every affected working plan against the accepted target.
3. Reconcile stale Tasks and active Changes.
4. Implement accepted lifecycle and evidence simplification slices with focused safety evidence.
5. Audit and implement broader simplifications that would otherwise invalidate portfolio migration.
6. Execute broad verification portfolio migration against the simplified system.
7. Continue Task Submission Planning Gate work only after its assumptions are refreshed.

The complete accepted decision ledger is [Lifecycle and evidence simplification review](lifecycle-evidence-simplification-review.md).

## Audit test

For each behavior or structure:

1. Identify the current observable outcome it protects.
2. Identify its owner and every caller that must know its rules.
3. Identify whether failure should reject, recover, warn, or request operator action.
4. Apply the deletion test.
5. Compare only credible smaller structures.
6. Preserve focused evidence for the accepted outcome.
7. Remove the replaced implementation, state, vocabulary, compatibility, and durable tests together.

A constraint should remain only when it protects approved intent, exact reviewed code, external mutation identity, durable-state consistency, user work, or truthful terminal outcomes.

## Accepted simplification targets

### Task and Change lifecycle ownership

Task should persist only Task-owned approval and terminal lifecycle facts.
Change should own implementation activity.
Remove caller-facing generic Task and linked-Task transition operations.
Remove duplicated transient Task states and derive activity for inspection.
Derive blocked activity from the unresolved Implementation Blocker.
Keep named and atomic Task and Change seams at Change Start, completion, and cancellation.
Make merged completion one specific compare-and-set persistence operation that receives the exact pull request, Candidate, and head observed by reconciliation.
In one transaction, compare that identity with current publication, close the Change, derive its linked Task, and complete the Task.
Do not repeat the GitHub request in SQLite or add a generic terminal evidence framework.
Permit normal implementation operations on an open Change by default.
Replace milestone-based permission gates with derived current validity for readiness, publication, blocked activity, and completion.
Reject an operation only when its immediate effect violates one of the accepted protected outcomes.

### Repository Preparation

Keep the Change Start preparation attempt, latest failure details, Implementer handoff, explicit `by change prepare <change-id>` retry, and mandatory preparation for each new Validation Run.
Allow implementation after preparation failure.
Remove persisted Change readiness, readiness transitions, the implementation and Submit readiness gate, and `change_not_ready`.
Treat the latest failure as recoverable setup evidence rather than lifecycle permission.
Do not add preparation history, concurrent-repair coordination, or trusted-policy override machinery without concrete evidence.

### Managed Worktree recovery

When an open Change's Managed Worktree is missing or stale, reattach the exact recorded Repository Branch at its current commit if it exists and is not attached elsewhere.
Remove readiness-based advanced-branch rejection.
Never reset the branch to its starting commit.
Reject a missing branch, another worktree attachment, or conflicting managed path with actionable facts.
Do not add reflog recovery or commit-selection machinery.

### Blocker, Acceptance Context, and publication records

Keep Implementation Blocker and Resolution history.
Keep every approved Resolution in current Acceptance Context and each Validation Run's exact context snapshot.
Remove the write-only Acceptance Context versions table.
Keep current publication and pending recovery evidence.
Remove immutable Candidate Publication chronology and its inspection surface.
Separate ongoing Submit orchestration from reconciliation.
Share one pure owned pull-request observation and identity classifier, but let Submit continue open or closed-unmerged work and let standalone reconciliation own exact merged completion and terminal cleanup retry.
After fresh passing Validation, publication may reopen and update the exact owned closed-unmerged pull request.
Do not create a second pull request or lifecycle state.
Remove `change_published` and `change_candidate_passed` Blocker-raise guards.
Allow one Blocker on any open Change, prevent authoritative Validation while it remains unresolved, and invalidate readiness when its Resolution changes Acceptance Context.
Do not require republishing when the same Candidate remains on the pull request and passes fresh Validation.

### No-Change completion

Remove the `no_change` completion kind, Acceptance-only No-Change Validation path, completion evidence, persistence fields, CLI result, compatibility behavior, and durable tests.
Remove the entire `TaskCompletionKind` concept and `completion_kind` SQLite column because `merged_pr` would otherwise be a constant duplicate of Done Task state and linked Change evidence.
Keep `nothing_to_submit` as a nonterminal observation with guidance to continue implementation or cancel explicitly.
Do not infer cancellation or successful completion from an empty diff.
Use existing cancellation for unnecessary Tasks, owned pull-request closure, and cleanup.
Do not add durable Research Tasks or research-result persistence now.

### Validation records

Keep Validation Run, Finding, and Tooling Failure history.
Remove Finding severity from active domain, schema, persistence compatibility, output, and tests.
Remove unused Validation phase status.
Keep exact Candidate, policy, workspace, and reviewer evidence required for truthful validation.

### Cancellation ownership

Allow `by change cancel <change-id> --reason <reason>` for task-backed and taskless Changes.
Keep `by task cancel` as a Task selector and route both commands through one Change-owned terminal operation when a Change exists.
Derive the linked Task, store the reason on the Task or taskless Change as applicable, and update terminal state atomically.
Remove the `task_backed_change` ban, hard-coded taskless reason, caller-supplied linked Task identity, and duplicated terminal logic.
Keep active Validation and unsafe or uncertain owned pull-request facts as immediate cancellation guards.

### Terminal cleanup

Use one idempotent terminal cleanup operation for completed and cancelled Changes, repeated cancellation, and reconciliation.
Persist terminal state with cleanup pending before cleanup begins.
Close any owned pull request before remote deletion.
Clean the Managed Worktree, local Repository Branch, Remote Change Branch, Reviewer Sessions, and Artifact content with the same default safeguards for completion and cancellation.
Retry cleanup through repeated cancellation or reconciliation.
Report terminal success with uncertain or pending cleanup when cleanup-result persistence fails instead of crashing or adding states.

Add `by change reconcile <exact-change-id> --discard-work` without persisted authorization.
Ordinary cleanup preserves dirty worktrees, unique local commits, and changed Remote Change Branch commits.
The explicit flag may discard those resources for that attempt.
A changed Remote Change Branch must still be read first and deleted with GraphQL compare-and-set against the exact observed commit.
Do not bypass repository identity, branch identity, or unreadable-remote safeguards.
Do not permit bulk discard.
Delete Change-owned Artifact content when terminal cleanup succeeds while retaining lightweight historical metadata.

### Structured Implementation Decisions

Keep `choice`, `rationale`, ordering, timestamps, review input, and pull-request rendering.
Remove legacy unstructured `content` compatibility.
Do not make Decisions authoritative acceptance input.

### Persisted-data CLI result

Map malformed consequential stored data to one shared `persisted_data_invalid` result.
Do not create a general impossible-state framework.

### SQLite snapshot command

Provide one explicit immutable full-database snapshot command.
Do not add Task Archives, automatic retention, restore orchestration, publication-triggered snapshots, or automatic pre-migration backup now.

## Recorded investigation candidates

### Reviewer Session storage

Keep only Change ID, producer, identity fingerprint, and session reference in Reviewer Session storage.
Remove the duplicate full identity JSON, last Candidate ID, update timestamp, fingerprint index, parsing, mapping, compatibility behavior, and related durable tests.
Use the fingerprint as the only stored compatibility identity for current reviewer setup.
No supported behavior reads the removed fields, and sessions are located by Change ID and producer rather than fingerprint.
This target supersedes completed BY-55's old storage detail without weakening continuity, known-good preservation, provider session validation, or unusable-session restart.

### Remote Change Branch deletion Adapter

The operator approved replacing current Git deletion with GitHub GraphQL `updateRefs` after completed static and live spikes supported it.
Live testing proved that wrong expected commits leave the branch unchanged and the exact expected commit deletes it.
Pre-read and post-error readback preserve missing-branch idempotence, changed-head safety, and uncertain-response recovery.

The replacement removes approximately 310 production lines of Git transport handling and 238 current remote-cleanup test lines.
It adds an estimated 150 to 190 production lines and 230 to 300 focused test lines, for an estimated net removal of 64 to 174 lines.
The larger simplification is removal of remote URL parsing, push URL selection, rewrite handling, temporary Git configuration, and cleanup-specific Git credential behavior.
Use already-recorded owner, repository, branch, and expected commit facts.
Do not add storage, configuration, a general GraphQL framework, or duplicated recovery state.

### Validation command runner

Current observable working-directory behavior is satisfied.
Investigate deleting duplicated async and Effect command-runner mechanics or tightening optional inputs only if the change reduces caller knowledge without adding another execution abstraction.
Do not create a standalone product Task for cwd propagation.

### Forward schema simplification

Keep immutable migrations `0001` through `0012` and add focused forward migrations.
Do not reset or squash the chain.
Use supported table rebuilds to remove obsolete active schema while preserving current Shared Repository State.
Historical migrations may retain retired representations because their immutable compatibility boundary is accepted.
Delete legacy-only Implementation Decision rows, Acceptance Context Version history, Candidate Publication chronology, Finding severity values, and removed Reviewer Session fields.
Keep current Acceptance Context, Validation Run snapshots, current publication facts, Findings, structured Decisions, and minimal Reviewer Session identity.
Preserve terminal Task states while dropping completion kind.
Do not map transient Task states to `todo`.
If an explicitly restored old database contains transient Task states, reject migration with the affected Task and linked Change facts rather than making stale work startable.
Do not use the explicit SQLite snapshot command as schema-aware restoration or a migration substitute.

### Final lifecycle and CLI gate audit

Keep closed Change rejection, exact Candidate and Change Base checks, one active Validation Run, unresolved-Blocker Validation rejection, owned pull-request identity checks, publication compare-and-set, uncertain-response recovery, and user-work safeguards.
Require Validation state `complete` as well as outcome `passed` before reuse or publication.
Make Validation persistence the single owner of active-run and unresolved-Blocker checks.
Narrow lower-level Candidate capture to the exact refreshed Change Base supplied by the owning Submit flow.
Share one pure owned pull-request fact classifier across Submit, publication, cancellation, and reconciliation.
Remove duplicate prechecks, transient Task transitions and rollback, `task_transition_failed`, milestone-specific permission errors, and misleading catch-all reconciliation or cancellation results.

## Rejected candidates

Do not add these mechanisms without new concrete evidence:

- A persisted Task Board model for a future terminal UI.
- A generic Reviewer Session coordinator.
- Fresh reviewer sessions for every Validation Run.
- A durable Follow-up issue lifecycle or automatic Task creation.
- Append-only Task Archives or a second writable Task representation.
- Automatic snapshot retention or restore orchestration.
- Generic Run, workflow, pipeline, compatibility, or impossible-state frameworks.
- Durable evidence whose only purpose is proving retired implementation vocabulary absent.

## Verification interaction

Each product simplification Task must identify its Material Risks and smallest sufficient Verification Claims before implementation.
Focused evidence must protect the slice while old behavior and tests are removed.
Broad portfolio migration later must map the complete remaining suite to the simplified capability seams and remove duplicate, flaky, obsolete, and implementation-choreography evidence.
The audit must not preserve a module or state solely because current tests depend on it.

## Completion

The audit is complete when every retained complexity item has one named owner and consequence, every accepted removal is implemented through an approved Task, every replaced path and test is removed, and the broad verification portfolio can target stable supported seams.
