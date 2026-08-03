---
status: approved-target-task-design-pending
artifact_kind: working-plan
remove_when: the operator approves the complete target, every accepted requirement and Task disposition is transferred to SQLite Tasks or an accepted ADR, applicable current documentation describes the implemented system, and deferred questions have authoritative dispositions
---

# Lifecycle and evidence simplification review

> Non-authoritative working plan.
> This file preserves accepted planning decisions and open questions from the lifecycle and evidence review.
> It does not describe current implemented behavior and does not authorize implementation or Task mutation.

## Outcome

But Why should apply only the lifecycle, evidence, and recovery constraints needed to protect accepted human intent, exact reviewed code, external mutation identity, durable-state consistency, user work, and truthful terminal outcomes.
The CLI should help an operator recover or decide instead of leaving recoverable work permanently blocked.
The review covers the complete Task and Change workflow rather than treating Candidate Publication as the only lifecycle boundary.

## Constraint test

A product constraint must protect at least one current outcome:

1. Approved human intent remains identifiable.
2. Validation applies to the exact Candidate that But Why reports as passed.
3. External mutations target the expected repository, branch, pull request, and commit.
4. Concurrent operations cannot corrupt durable state.
5. Destructive cleanup cannot silently lose unique work.
6. Only authoritative terminal facts complete or cancel work.

Each retained constraint must have one owner, use the smallest applicable scope, and give the next safe action when recovery is possible.
Uncertain external or tooling facts must not become false completion, cancellation, or permanent rejection.
Parser convenience, provider mechanics, current implementation shape, and speculative future behavior must not become domain lifecycle rules.

## Accepted Task and Change ownership

Task owns proposed intent, approval, dependencies, terminal completion, cancellation, and cancellation reason.
Change owns implementation activity, Candidates, Validation Runs, active Implementation Blockers, readiness, publication evidence, reconciliation, and cleanup.
Task and Change must interact through named, intentional seams at Change Start, terminal completion, and cancellation.
Caller-facing generic Task and linked-Task state transition operations must be removed.
A Change-owned terminal operation must derive the linked Task from durable Change state and update the Change and linked Task atomically.
Callers must not supply a Task identity that the Change already owns.
External reconciliation owns the GitHub observation that an owned pull request merged an exact Candidate.
One specific terminal persistence operation should receive the observed pull request, Candidate, and expected head identity, compare them with the current durable publication in the same transaction, and only then close the Change and complete its linked Task.
The persistence operation must reject stale observed identity so reconciliation can retry.
SQLite must not repeat the GitHub request, and But Why should not add a generic terminal framework or evidence-object hierarchy.

The persisted Task lifecycle should contain only the Task-owned states currently represented by `new`, `todo`, `done`, and `cancelled`.
Implementation activity currently represented by `implementing`, `validating`, `blocked`, and `ready` should be derived from Change facts.
An unresolved Implementation Blocker should be the authoritative blocked fact instead of duplicated Task and Change blocked states.
Current Task inspection should compose Task availability and Change activity through one read projection.
A future terminal Task board may consume that projection, but the future UI does not justify a persisted board model or new board framework now.

## Accepted open-Change validity model

An open Change permits normal implementation operations by default.
Earlier milestones must not permanently remove capabilities or require later operations to be added as exceptions.
An operation may be rejected only when its immediate effect would violate approved intent, exact reviewed Candidate identity, external mutation identity, durable-state consistency, user-work safety, or truthful terminal outcomes.

Readiness, publication, blocked activity, and completion are validity claims derived from current facts rather than permissions granted by accumulated lifecycle states.
A Change is ready only when its latest Candidate passed under the current Acceptance Context and Validation Policy.
A Change is published only when its owned pull request currently contains that exact Candidate.
A Change is blocked only while an unresolved Implementation Blocker exists.
A Change is complete only when authoritative external evidence shows that the owned pull request merged the exact accepted Candidate.

A new Candidate or changed Acceptance Context invalidates readiness instead of erasing prior Validation evidence.
A changed Candidate invalidates current publication identity until the pull request contains that Candidate.
A Resolution changes Acceptance Context and therefore requires fresh Validation.
If the same Candidate remains on the owned pull request and passes fresh Validation, But Why must not require artificial republishing.
Prior Validation Runs and publication facts remain historical evidence and do not grant current validity.

The immediate justified rejection cases include a terminal Change, a conflicting active Validation Run, an unresolved Blocker at authoritative Validation, missing current passing evidence at publication, destructive cleanup that can lose unique work, and completion without exact merged-Candidate evidence.
This list describes protected outcomes rather than a new closed permission list.

## Accepted removal of No-Change completion

But Why Tasks represent accepted implementation intent, and Changes represent implementation activity that produces a repository Candidate.
A zero-diff Candidate does not establish why implementation produced no repository change.
It may mean the requirement was already satisfied, the Task was unnecessary, implementation was abandoned, research produced no mutation, or work was accidentally reverted.
But Why must not infer a successful terminal result from that ambiguity.

The `no_change` completion kind, Acceptance-only No-Change Validation path, No-Change completion evidence, persistence fields, CLI result, compatibility behavior, and durable tests should be removed.
Removing `no_change` leaves `merged_pr` as the only completion-kind value, so the entire `TaskCompletionKind` concept, `completion_kind` SQLite column, Task inspection field, compatibility behavior, and durable tests should also be removed.
A Done Task plus its linked closed Change already provides the terminal state and exact merge evidence.
An implementation Task completes only through authoritative evidence that the owned pull request merged the exact accepted Candidate.
An unnecessary, invalid, or abandoned Task must be cancelled explicitly with an operator-owned reason.
When Change Submit captures no repository difference from the refreshed base, it should return `nothing_to_submit` with guidance to continue implementation or cancel explicitly.
This behavior applies whether the Change is Task-backed or taskless and whether it had earlier publication evidence.
Existing cancellation owns pull-request closure and terminal cleanup, so No-Change removal requires no special post-publication exception.

Research, investigation, and planning remain ad hoc session or delegated-agent work for now.
Only the synthesized implementation intent should become a durable SQLite Task.
But Why should not add Research Tasks, research-result persistence, staleness management, or additional terminal result types without concrete repeated-work evidence.
The possible cost of repeated ad hoc research is accepted until repository evidence justifies a durable concept.

## Accepted Repository Preparation behavior

Change Start should create the Managed Worktree and attempt the trusted Change Base Repository Preparation command.
Preparation failure should report and persist only the latest command, exit code, timeout, stdout, and stderr.
Preparation failure must not block the Implementer from starting.
The Implementer handoff should include the latest failure so a separately launched session can act on it.
`by change prepare <change-id>` should remain as an explicit retry that runs the trusted command in the Managed Worktree and clears the latest failure on success.
Persisted Change readiness values `pending`, `ready`, and `prepare_failed`, the readiness gate, and `change_not_ready` should be removed.
Every new Validation Run should create a fresh Validation Workspace and run trusted Repository Preparation there before Checks and review.
A reused completed passing Validation Run should not rerun preparation.
Validation preparation failure remains a Finding that prevents publication.
No coordination machinery for simultaneous preparation-repair Changes or trusted-policy override for changing a broken baseline preparation command is justified without a concrete case.

## Accepted Managed Worktree recovery behavior

If an open Change's Managed Worktree is missing or has a stale registration but its exact recorded Repository Branch still exists and is not attached elsewhere, recovery should recreate the Managed Worktree at that branch's current commit.
Recovery must preserve every commit on the recorded branch and must not reset it to the Change starting commit.
New commits on the exact recorded branch are work to preserve rather than a readiness conflict.
If the branch is attached to another worktree, the recorded branch is missing, or the managed path contains conflicting files, recovery should stop with actionable conflict information.
But Why should not guess a replacement commit or add reflog recovery and commit-selection machinery.
The operator may recover the branch externally or cancel the Change.

## Accepted Blocker and Resolution behavior

Implementation Blocker and Resolution history remains useful operational and review evidence.
Only one unresolved Implementation Blocker may be active for a Change.
For a Task-backed Change, every operator-approved Resolution remains part of Acceptance Context.
For a taskless Change, a Blocker signals that operator intervention is required because the Change cannot progress normally.
Its Resolution remains immutable Change history, invalidates prior Validation, and requires fresh Validation without creating Acceptance Context or triggering Acceptance Review.
But Why must not classify Resolutions by whether they change intent because that classification would add more complexity than retaining the complete Resolution.
The current Acceptance Context remains available for the next review, and each Validation Run retains the exact Acceptance Context it used.
The write-only Acceptance Context versions table should be removed.

If the owned pull request merges the exact latest published Candidate, reconciliation must close the Change and complete the Task even when an unresolved Implementation Blocker remains.
A Blocker is active only while its Change remains open.
Completion must leave the existing Blocker record as history without creating a synthetic Resolution or a `resolved_by_completion` state.

## Accepted Implementation Decision behavior

Structured Implementation Decisions remain useful non-authoritative rationale.
They support pull-request explanation, later analysis of mistaken or repeated choices, and possible future PR writing.
The active representation should retain `choice`, `rationale`, sequence, timestamp, Change ownership, pull-request rendering, and the exact Decision input supplied to review.
Legacy unstructured `content` compatibility should be removed because But Why is unreleased.
Implementation Decisions must not amend Acceptance Context or become Validation authority.

## Accepted Validation and evidence behavior

Exact Candidate identity, isolated Validation Workspaces, Candidate integrity checks, the fixed Validation Gate, exact merged-head reconciliation, safe uncertain-publication recovery, cancellation safety, and exact-head cleanup remain justified.
Validation Run history, Findings, and Tooling Failures remain valuable observability for nondeterministic reviewer and tooling behavior.
But Why should keep the current local Validation Run inspection model and should not add telemetry, dashboards, archival, or pruning until measured cost justifies them.
Finding severity must be removed from active types, persistence, schema, compatibility behavior, and tests because every current Finding is blocking.
The unused Validation phase-status model must be removed because persistence and readers use only round status, Validation Run state, and Validation Run outcome.

Reviewer Session continuity across Candidates is mandatory because fresh sessions impose unacceptable orientation cost and latency.
Acceptance and Specialist reviewers retain independent sessions.
Temporary failures must preserve the last known-good session.
An unusable session may receive one fresh restart.
Provider-specific session-usability classification belongs inside Reviewer Agent Runtime.
Acceptance and Specialist phases should consume only a project-owned `unusable | unknown` result.
The current Acceptance Reviewer Session cleanup path mismatch must be corrected through one canonical path function.
Reviewer Session storage should retain only Change ID, producer, identity fingerprint, and session reference.
The fingerprint remains the runtime compatibility identity for profiles, instructions, Agent Environment, tools, skills, and extensions.
No supported inspection or recovery path uses the full identity JSON, and comparing two duplicated identity representations protects only their agreement.
The stored last Candidate ID and update timestamp are written but never read, and no query uses the fingerprint index.
The full identity JSON, last Candidate ID, update timestamp, fingerprint index, related parsing and mapping, compatibility behavior, and durable tests should be removed together.
This accepted direction explicitly supersedes completed BY-55's old requirement to store the current identity, fingerprint, session reference, and last reviewed Candidate.

## Accepted publication and cleanup direction

Candidate Publication means only that But Why placed one exact validated Candidate on one owned pull request.
Publication does not mean human approval, Change completion, frozen implementation, or an expectation that the pull request will merge without revision.
The current exact publication state and pending recovery facts remain required.
Immutable Candidate Publication chronology and its inspection command should be removed because operational recovery and reconciliation consume only current publication evidence.
Publication must not become a generic gate on unrelated open-Change operations without a concrete protected outcome.
The current `change_published` and `change_candidate_passed` rejections for raising an Implementation Blocker must be removed.
Any open Change may record a new Blocker when none is active.
The unresolved Blocker prevents authoritative Validation, and its Resolution invalidates readiness by changing Acceptance Context.

Change Submit should not call the full reconciliation workflow for an ongoing Change.
Submit and reconciliation should share one owned pull-request observation and identity classifier without sharing lifecycle orchestration.
Submit should observe the current owned pull request before Candidate work.
An exact merged Candidate should complete through the accepted terminal operation, an open pull request should allow Submit to continue, and a closed unmerged pull request should also allow Candidate capture and Validation.
After Validation passes, publication should reopen and update the exact owned pull request.
Unavailable or mismatched repository, pull-request, branch, or commit facts should stop safely.
Standalone reconciliation should use the shared observation only to discover exact merged completion and retry terminal cleanup.
It should not reopen pull requests or restart ongoing work.
No second pull request or additional lifecycle state is justified.

Validation Artifact files live under shared Git operational state and are not removed with Validation Workspaces or Managed Worktrees.
At the time of review, shared Artifact storage contained 753 Validation Run directories, 7,896 files, and approximately 37 MiB.
Artifact content should remain available while a Change is active and should be deleted when terminal Change cleanup succeeds.
Lightweight Validation Run, Finding, Tooling Failure, and Artifact metadata should remain for historical analysis.
Historical Artifact retrieval should report expired content explicitly.
No content-addressed storage, hashing, external archival, or age-based retention is justified now.

Ordinary cleanup must preserve dirty worktrees, unique local commits, and Remote Change Branches whose current commit differs from recorded publication.
Targeted reconciliation should accept `by change reconcile <exact-change-id> --discard-work` only when one exact Change ID is supplied.
The option authorizes that command attempt to delete a dirty Managed Worktree, unique local commits, and a changed Remote Change Branch.
For a changed Remote Change Branch, But Why must first read its current commit and then delete that exact observed commit through GraphQL compare-and-set.
The option must not bypass repository or branch identity checks and must not delete when the current remote commit cannot be read.
Bulk reconciliation must not accept the option.
The option must not create persisted discard authorization or another cleanup state.

Every closed Change should use one idempotent terminal cleanup operation for completion, cancellation, repeated cancellation, and reconciliation.
Cancellation should persist terminal state with cleanup pending before cleanup begins.
Cleanup should close an owned pull request before deleting its Remote Change Branch and should include the Managed Worktree, local Repository Branch, Remote Change Branch, Reviewer Sessions, and Artifact content.
Cancelled and completed Changes should use the same cleanup scope and safeguards.
Repeated cancellation of an already cancelled Change should retry pending cleanup.
If cleanup or cleanup-result persistence fails, the terminal cancellation remains true and the command should report cleanup as uncertain or pending with retry guidance.
No background worker, cleanup history, automatic retry schedule, or additional cleanup state is justified.

`by change cancel <change-id> --reason <reason>` should cancel any open Change, whether task-backed or taskless.
`by task cancel` should remain for callers that start from a Task, and both commands should use the same Change-owned terminal operation when an active Change exists.
The terminal operation should derive any linked Task from the durable Change instead of accepting a caller-supplied Task ID.
For a Task-backed Change, it should store the reason on the linked Task.
For a taskless Change, it should store the reason on the Change and expose it through Change inspection.
It should close the Change and cancel any linked Task in one transaction.
The public `task_backed_change` operation ban and hard-coded taskless reason should be removed.
Active Validation and unsafe or uncertain owned pull-request facts should continue preventing cancellation.
Cancellation reasons should not be copied into pull-request comments or bodies because that duplication creates uncertain external recovery without helping But Why operate the Change.

## Accepted Shared Repository State recovery direction

Append-only Task Archives, per-mutation archive hooks, Task normalization during restore, and a second writable Task representation are rejected.
But Why should instead provide one explicit immutable full-SQLite snapshot command using SQLite's supported backup operation.
Snapshots should use unique paths under shared Git operational state and must not overwrite earlier snapshots.
Automatic snapshot retention, restoration, publication-triggered snapshots, and automatic pre-migration snapshots are not justified now.
A repository-specific Implementation Advisor rule should identify Shared Repository State migrations or destructive persistence changes and advise the operator to create a snapshot shortly before merge.
This advice is not enforcement.
Automatic pre-migration backup may be reconsidered with published compatibility work if advisory snapshots prove insufficient.

## Accepted migration-chain direction

Keep the immutable ordered `0001` through `0012` Effect SQL migration chain and add focused forward simplification migrations.
Do not reset or squash the chain before first release.
The active Shared Repository State contains substantial Task, Change, Candidate, Validation, Finding, Artifact, Decision, Blocker, publication, and cleanup facts that must not be discarded for aesthetic migration cleanup.
Resetting while preserving those facts would require export, conversion, ledger replacement, and atomic cutover, which is more complex and risky than supported table-rebuild migrations.
Fresh databases may pass through retired historical schemas before reaching the supported final schema.
The immutable migration boundary is the accepted reason those historical Migration Artifacts retain retired representations.
New migrations should remove obsolete active tables, columns, indexes, and compatibility behavior while preserving current supported facts.
Delete legacy-only Implementation Decision rows instead of inventing structured `choice` or `rationale` values.
Delete Acceptance Context Version history while retaining current Acceptance Context and Validation Run snapshots.
Delete Candidate Publication chronology while retaining current publication facts.
Drop Finding severity while retaining Findings.
Drop removed Reviewer Session fields while retaining Change ID, producer, fingerprint, and session reference.
Preserve existing terminal Task states while dropping the completion-kind label.
Do not map transient Task states to `todo` or infer resumable work from a linked Change.
The active database has no transient Task states, and the eight unique transient Tasks found across historical snapshots are all Done through merged pull requests in active state.
Historical snapshots are not automatically migrated.
If an operator explicitly restores an old database with transient Task states, the migration should stop with an actionable report of each affected Task and linked Change instead of making work newly startable.

## Accepted CLI error direction

Malformed or inconsistent persisted data must not be reported as unavailable storage.
The shared CLI result mapping should expose one stable `persisted_data_invalid` result for `RepositoryPersistedDataInvalid`.
The result should include the operation and only those record or field identifiers already known at the decoding seam.
Expected domain conflicts must remain operation-specific results.
SQL availability and migration failures must remain infrastructure failures.
Programmer defects must remain `internal_error`.
But Why must not add one public variant or durable test for every impossible internal state.

## Deferred follow-up discovery

A durable Follow-up concept, automatic Task creation, issue detection, deduplication, triage state, and promotion workflow are not justified now.
An active Implementation Blocker remains scoped to completing its current Change.
When the operator accepts out-of-scope work, the operator may create a normal unapproved Task.
Future follow-up capture should wait for concrete examples showing that manual operator-created Tasks are insufficient.
If evidence appears, first evaluate non-authoritative Implementation Advisor suggestions that require explicit operator promotion.

## Accepted stale Task dispositions

No Task mutation is authorized by this plan alone.
The operator accepted these proposed dispositions for the later reconciliation mutation:

- BY-14 should be cancelled as stale and recreated only when first npm publication becomes the immediate outcome.
- BY-15 should be cancelled as premature and recreated only when a real post-publication upgrade is ready to implement and verify.
- BY-41 should be cancelled as superseded, while local taskless cancellation-reason storage moves into terminal lifecycle work.
- BY-42 should be cancelled as superseded, while targeted `change reconcile <change-id> --discard-work` moves into terminal cleanup work.
- BY-53 should be cancelled as superseded, while an explicit immutable SQLite snapshot command and migration-related Advisor rule remain replacement requirements.
- BY-60 should remain approved and should deepen the existing Reviewer Agent Runtime without adding a generic coordinator.
- BY-66 should be cancelled as superseded, while its durable linked-Task identity invariant moves into Task and Change lifecycle work.
- BY-68 should be cancelled as effectively satisfied, with optional command-runner cleanup left to the codebase simplification audit.
- BY-69 should be cancelled as overbroad, while one shared `persisted_data_invalid` CLI behavior remains replacement work.
- BY-70 should remain approved and implement the operator-approved GraphQL Remote Change Branch deletion replacement proved by the completed spike.
- BY-71 should be cancelled as obsolete without preserving setup deduplication as a product requirement.

BY-89 is cancelled and its Change is closed.
Its cleanup remains pending because its unique local branch is not reachable from another ref.
The accepted targeted discard behavior should provide its future explicit cleanup path.
BY-99 is Done, merged through pull request 78, and fully cleaned up.

## Future first-release direction

The first-release Task should be created only when publication becomes the immediate outcome.
It should publish the exact tarball verified from the final release tree, verify registry integrity against those bytes, verify registry execution, bind the source tag and GitHub Release to the exact source, and retry failed publication only with the same version and tarball.
The release design should consider `npm install --global but-why` as a supported installed Node executable path in addition to portable `pnpx` and `npx` paths.
A standalone native executable is out of scope.
First-release compatibility promises belong in that future release Task.
A real upgrade-verification Task should be created only when a second published version becomes imminent.

## Integrated initiative sequence

The previous sequence that migrated the broad verification portfolio before product simplification is superseded.
The accepted planning order is:

1. Finish the system-wide minimal-constraint review.
2. Refresh the lifecycle, verification, reconciliation, simplification, and Planning Submission working plans together.
3. Reconcile stale Tasks and active Changes against the accepted target before creating replacement Tasks.
4. Implement approved lifecycle and evidence simplification slices with focused Task Verification Contracts and focused safety evidence.
5. Run the broader codebase simplification audit and implement accepted simplifications that would otherwise invalidate portfolio migration.
6. Execute the broad verification portfolio migration against the simplified ownership seams.
7. Continue Task Submission Planning Gate implementation only after its assumptions are refreshed against the resulting Task model.
8. Create release work only when publication becomes the immediate outcome.

Refreshing verification portfolio design early and executing broad portfolio migration later are separate operations.
Each simplification slice must retain the focused evidence needed to change behavior safely.
Broad portfolio migration later maps the complete retained test inventory to approved risks and claims, removes obsolete and duplicate evidence, and consolidates expensive integration sentinels.
Planning order does not create a Task Dependency unless a later Task cannot be implemented or verified without an earlier completed result.

## Accepted final gate-audit consequences

Closed Change state remains the general terminal mutation guard.
An unresolved Blocker should prevent authoritative Validation through an unresolved-row lookup, not block unrelated Candidate capture, Decision recording, preparation, or implementation operations.
Validation persistence should be the single owner of active Validation Run uniqueness and Blocker rejection, so duplicate Submit prechecks and transient Task rollback transitions should be removed.
Only a completed passing Validation Run for the exact Candidate, current Acceptance Context, current policy, and implementation input may be reused or published.
A merely passed but incomplete Validation Run is not valid evidence.
Candidate capture should accept the exact refreshed Change Base only through a narrow internal seam and should retain branch, ancestry, workspace cleanliness, repository identity, and user-work safeguards.
Publication should retain exact local head, durable pending marker, returned pull-request identity, and post-mutation comparison safeguards.
Owned pull-request repository, base branch, head branch, head commit, state, and merge facts should use one shared pure classifier across Submit, publication, cancellation, and reconciliation.
Uncertain GitHub, cleanup, or persistence facts should remain operational recovery results rather than misleading terminal or identity rejection results.
Generic `task_transition_failed`, duplicated transient-state conflicts, and milestone-specific permission errors should be removed with their retired mechanisms.

## Completed BY-70 GraphQL spike

The bounded static and live spikes support replacing Git Remote Change Branch deletion with GitHub GraphQL `updateRefs`.
The live API rejected wrong `beforeOid` values without changing the branch and deleted the branch only when `beforeOid` matched the exact current commit.
An all-zero `afterOid` performed deletion, and an all-zero missing-ref operation provided idempotent recovery.
Opaque GraphQL errors require the same safe pattern as current Git uncertainty: read the branch again, treat confirmed absence as complete, report a changed head as mismatch, and otherwise keep cleanup pending.

The current removable Git transport cluster is approximately 310 production lines and 238 remote-cleanup test lines.
The credible GraphQL replacement is approximately 150 to 190 production lines and 230 to 300 focused test lines, for an estimated net removal of 64 to 174 lines.
More importantly, it removes remote URL parsing, push URL selection, rewrite handling, temporary bare Git configuration, and Git credential transport from cleanup.
The GraphQL Adapter can use already-recorded owner, repository, branch, and expected commit facts without new storage or configuration.
The exact-head safeguard, missing-branch idempotence, uncertain-response recovery, cleanup ordering, and pending reconciliation remain.

The operator approved the GraphQL replacement and reported deleting the private spike repository `Vistyy/by70-graphql-delete-ref-20260803140717-2`.
BY-70 should remain approved and own the replacement.
The implementation should use one focused GraphQL Adapter with pre-read, exact `beforeOid`, all-zero `afterOid`, and post-error readback.
It must not add storage, configuration, a generic GraphQL framework, or duplicated recovery state.

## Deferred review triggers

Planning Submission rules require a later dedicated refresh after lifecycle simplification, broader codebase simplification, and broad verification portfolio closure.
Retention or pruning requires measured database or Artifact growth that current terminal Artifact cleanup does not control sufficiently.
Durable follow-up triage requires concrete missed work showing that explicit operator-created Tasks are insufficient.
These deferred triggers are not current requirements and do not block the lifecycle and evidence target.

## Approval state

The operator approved every individual decision identified as accepted in this plan.
The operator approved the complete lifecycle and evidence simplification target for Task reconciliation and replacement Task design.
The operator has not approved a replacement Task graph, Shared Repository State mutation, or implementation Change.
