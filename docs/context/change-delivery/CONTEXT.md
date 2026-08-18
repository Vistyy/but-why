# Change Delivery Context

This context owns code lineage, implementation, Candidate selection, validation, publication, reconciliation, and Change completion.

Task/Change coordination is the only application boundary that crosses Task and Change state.
Change persistence owns Change state, authority, Candidate and Validation evidence, publication, closure, and cleanup.
It does not mutate Task state or expose the correlation link as public Change inspection data.

## Language

**Change**:
The durable owner of one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and owned pull request, optionally linked to one Task.
A Change has a SQLite-allocated internal integer identity, and its public ID is `<id-prefix>-C<change-integer>`.
_Avoid_: Task, branch, pull request, generic workflow

**Change linked to a Task**:
A Change linked to one Task and its Acceptance Context.
_Avoid_: Task, Task Worktree

**Change without a Task**:
A Change with no linked Task or Acceptance Context that remains eligible for code-based validation and publication.
_Avoid_: Ad hoc worktree, implicit Task

**Open Change**:
A Change whose implementation, validation, publication, or merge observation may still advance.
_Avoid_: Active process, current Validation Run

**Change Activity**:
A derived inspection classification of a linked Open Change as `implementing`, `validating`, `blocked`, or `ready`.
It is absent for an unlinked Task or a linked Closed Change.
When facts overlap, an unresolved Implementation Blocker takes precedence, then an Active Validation Run, then current passing Validation evidence.
It is distinct from Task Lifecycle and is not persisted as Task state.
_Avoid_: Task State, Task progress

**Blocked Change**:
An Open Change with one unresolved Implementation Blocker.
Blocked Change activity is derived from the unresolved Blocker row and is not persisted as Change or Task lifecycle state.
Blocker operations neither write nor depend on blocked lifecycle state.
_Avoid_: Closed Change, Validation Run blocked by Findings

**Closed Change**:
A Change permanently completed or cancelled while preserving its history.
_Avoid_: Deleted Change, merged branch

**Repository Branch**:
The canonical local branch reference durably owned by one open Change.
_Avoid_: Worktree path, Remote Change Branch, Candidate

**Remote Change Branch**:
The remote Git branch that Candidate Publication creates or updates as the head of one Change's owned pull request.
_Avoid_: Repository Branch, GitHub PR Target

**Change Base**:
The recorded remote branch that is the comparison and publication target from which a Change's Candidates are judged.
But Why fetches the Change Base at Change Start and before each Submission.
_Avoid_: Local branch, current merge base chosen implicitly, starting worktree path

**Candidate**:
One immutable committed code state identified within a Change by its exact fetched Change Base commit and Repository Branch head commit.
The Repository Branch must contain that Change Base commit before the Candidate is created.
_Avoid_: Change, working tree, resolved target, comparison base, merge-base pair, Submission, Validation Run

**Current Candidate**:
The latest Candidate selected from the Managed Worktree for the open Change.
_Avoid_: Latest historical Candidate, dirty workspace

**Candidate Publication**:
The act of placing one exact Candidate and its passed Validation Run as the head of a Change's owned pull request.
New or revised publication requires complete, passed evidence for the exact Current Candidate.
Fresh passing evidence for the same Candidate already on the owned pull request records the Validation Run without artificial republication.
When an open owned pull request already identifies a revised exact current validated Candidate, publication reconfirms the Remote Change Branch, skips a duplicate push, preserves the pull request title, requests the open state and current generated body, and confirms the exact publication facts.
Pull request metadata is presentation and is not Candidate identity or completed publication evidence.
A Remote Change Branch at the previously published head is updated with the exact force-with-lease safeguard, while any other remote head remains rejected.
Current publication facts record the exact Candidate, Validation Run, target, head branch, expected head commit, and owned pull request.
A completed publication remains ready when its persisted Candidate, persisted Validation Run, exact owned pull request, and local Repository Branch head still match.
Later Change Base or configuration changes do not alter that completed evidence.
An unresolved Implementation Blocker still prevents Submission from advancing.
A changed Current Candidate requires eligible evidence for the new Candidate.
_Avoid_: Current Candidate, mutable pull request state, Submission

**Exact Merged Candidate**:
An Exact Merged Candidate is the Candidate in current publication.
Its owned pull request is observed as closed and merged with matching repository, base branch, head branch, head commit, and pull request identity.
It is the only external evidence that can complete the Change and, through Task/Change coordination, its linked Task.
_Avoid_: Merged pull request, historical Candidate, current Candidate

**Acceptance Context**:
One immutable version of approved intent.
A Change linked to a Task captures its initial version from the approved Task when the Task starts.
Acceptance Review uses supplied Acceptance Context as review authority.
A Specialist Review that receives Acceptance Context uses it only as an authoritative scope constraint.
An Implementation Blocker Resolution for a Change linked to a Task becomes part of the current Acceptance Context through derivation from the immutable initial snapshot and ordered Resolution records.
A Resolution for a Change without a Task remains Change history and creates no Acceptance Context.
A Validation Run retains the exact Acceptance Context it used through its Validation Policy Snapshot.
_Avoid_: Current mutable Task text, Specialist instructions, inferred intent, Implementation Blocker report

**Validation Run**:
One durable execution and judgment of one Candidate under one resolved validation policy.
Validation start-or-reuse rejects a Change with an unresolved Implementation Blocker, and validation persistence keeps at most one Active Validation Run per Change.
Each Validation Run records the exact Candidate, the Validation Policy Snapshot including the current Acceptance Context when present, the Implementation Decision input, and the latest resolved Implementation Blocker identity when the Run starts.
Reuse and publication use a complete passed Run for the exact Current Candidate.
Current passing evidence is the newest eligible passed Run in immutable Validation Run History.
Change inspection uses that passing judgment for the Current Candidate rather than the newest Run of any outcome.
A later failed or tooling-failed Run does not hide eligible passing evidence, and neither outcome is reused as a passed judgment.
When a later Submission follows such a Run for the unchanged Current Candidate, it starts Validation again rather than reusing an earlier pass.
Acceptance Context, Validation Policy Snapshot, Implementation Decisions, and resolved Implementation Blocker history remain immutable Run provenance rather than reuse invalidators.
A changed Current Candidate requires eligible evidence for the new Candidate without deleting historical evidence.
For a Change without a Task, a later Resolution makes earlier Runs historical without creating Acceptance Context or Acceptance Review input.
_Avoid_: Candidate, retry Attempt, generic job

**Active Validation Run**:
The sole running Validation Run durably related to one Change until it completes or an operator explicitly abandons it.
Its Change and linked Task cannot be cancelled while it remains active.
_Avoid_: Process lock, reviewer process, current Submission

**Validation Run Abandonment**:
The explicit operator recovery that completes an interrupted Active Validation Run as tooling-failed after its processes stop and its exact resources are handled.
_Avoid_: Automatic cleanup, process termination, cancellation

**Validation Run State**:
The state of a Validation Run: running or complete.
_Avoid_: Task state, phase result

**Validation Run Outcome**:
The completed result of a Validation Run: passed, blocked by Findings, or failed because of tooling.
_Avoid_: Needs Input, reviewer status, Task state

**Validation Run History**:
The ordered immutable Validation Runs retained for one Change and its Candidates, including passed, Findings-blocked, tooling-failed, and abandoned Runs.
History does not select or invalidate current passing evidence by recency alone.
_Avoid_: Mutable current report

**Validation Policy Snapshot**:
The immutable resolved Acceptance Context, Agent Environment, Prepare, Checks, copied local files, and other Run-specific policy used by one Validation Run.
The Validation Policy Snapshot does not duplicate Acceptance or Specialist reviewer configuration.
Validation joins the Change-owned reviewer roster, instructions, and resolved Agent Profiles that Change Start froze from the exact fetched starting Change Base and current Global Config.
Change Submit resolves Run-specific policy from the exact fetched Change Base and does not read Candidate Repo Config as policy.
An eligible pre-conversation correction resolves replacement authority from the exact fetched current Change Base and current Global Config before the effective configuration's resources are validated.
Later configuration changes do not alter the snapshot or its historical Validation Run, and they do not invalidate a passed judgment for the same Candidate.
_Avoid_: Mutable current config, Candidate-controlled policy, raw config hash, retroactive policy

**Agent Session**:
The durable conversation owner for one Task Reviewer or one Change reviewer producer.
It owns the ordered Agent Continuations and their Invocations while the domain owner retains policy, Findings, and lifecycle state.
An Agent Session does not cross its Task or Change owner boundary.
_Avoid_: alternate reviewer record, fresh conversation per Candidate, cross-owner conversation

**Agent Continuation**:
One Pi harness continuation within an Agent Session.
A continuation records its fixed harness configuration, transcript path, and unusable state.
A new continuation is appended when the current continuation cannot safely resume.
_Avoid_: Agent Session, reviewer policy, transcript copy

**Agent Invocation**:
One dispatched host call in an Agent Continuation.
An Invocation is settled exactly once as returned, launch_failed, failed, or return_unknown and records token evidence when available.
Task Review and Change Validation link each Invocation to their own domain evidence.
_Avoid_: reviewer attempt, cumulative session usage, reviewer outcome

**Agent Session Configuration**:
The resolved Pi harness, provider, model, and thinking configuration fixed for an Agent Session.
A Task stores its resolved Task Reviewer configuration atomically with the first linked Invocation, and Change Start stores its resolved reviewer roster before implementation.
Later configuration changes do not alter these stored facts.
_Avoid_: current Repo Config, Agent Profile name alone, prompt

**Agent Transcript**:
The complete Pi session conversation produced by one Agent Continuation.
The Agent Continuation records its path relative to the operational session root when the transcript is available.
_Avoid_: Review report, reviewer stdout, security audit trail

**Agent Continuation Usability**:
The Agent Runtime classification after a failed resumed Invocation.
`unusable` means the stored Agent Continuation is proven unable to continue, while an unknown return keeps the continuation preserved for explicit recovery.
_Avoid_: Provider error message, automatic retry status

**Invocation Token Evidence**:
The token usage evidence for one Agent Invocation.
A measured Invocation records its input, cache-read, cache-write, output, and total token counts, while unavailable usage is recorded as `null` and is not treated as zero.
A resumed Agent Continuation produces new Invocation Token Evidence for each Invocation instead of repeating cumulative session usage.
_Avoid_: Agent Session total, inferred zero usage, cumulative resumed-session usage

**Producer**:
The named source of validation evidence, such as Prepare, a Check, Acceptance Review, or a Specialist Review.
A Producer identifies the source that creates an Artifact or Finding.
_Avoid_: Agent Profile, Agent Session, Validation Run

**Reviewer Producer**:
A Producer identifier for an Acceptance Reviewer or Specialist Reviewer that owns an Agent Session within its Change.
_Avoid_: Agent Profile, generic validation phase, cross-Change reviewer

**Artifact**:
A durable reference to bounded validation evidence with explicit Run, phase, producer, storage, and truncation metadata.
_Avoid_: Untracked file, copied secret content, console-only output

**Artifact Content**:
The bounded filesystem content addressed by an Artifact's metadata.
It remains available while its Change is Open.
Terminal Cleanup removes it for the exact Closed Change, and its absence after closure has no diagnostic meaning.
Artifact metadata remains inspectable.
_Avoid_: Artifact metadata, archived content, expired content

**Change Start**:
The operation that creates a Change, its Managed Worktree, and its starting commit.
A linked start is coordinated with one approved Task and captures its initial Acceptance Context.
An unlinked start has no Acceptance Context.
_Avoid_: Agent launch alone, validation, arbitrary state assignment

**Implementation Authorization**:
The Operator's explicit permission to begin implementing one selected work item through its selected Work Route.
Task Recording Authorization and Task Submission do not grant it.
It applies to Changes linked to a Task, Changes without a Task, and direct edits.
For a Change linked to a Task, Implementation Authorization requires starting or verifying a fresh Implementer Interactive Session.
For a Change without a Task, implementation remains in the current session unless Implementation Authorization explicitly requests a fresh Implementer Interactive Session.
_Avoid_: Task Submission, Task Recording Authorization, inferred permission to implement, authorization for unrelated work

**Managed Worktree**:
The persistent But Why-owned Git branch and linked worktree belonging to one open Change.
_Avoid_: Snapshot Workspace, caller checkout, temporary agent worktree, Task Worktree

**Interactive Session**:
An optional visible external-agent process hosted in a Managed Worktree, with Herdr as the current v1 integration.
_Avoid_: Task state, Validation Run, background Supervisor worker

**Implementer**:
The coding agent that changes a Change's Managed Worktree and may author Implementation Decisions or Implementation Blockers.
_Avoid_: Acceptance Reviewer, Specialist Reviewer, reviewer process

**Implementer Prompt**:
Optional non-authoritative Markdown supplied to Change Implement and appended to the Implementer's initial prompt.
It carries current information that the Implementer cannot obtain from Change inspection, accepted intent, or packaged instructions.
Durable authority must use the applicable Task or Change operation instead.
_Avoid_: Task Context, Acceptance Context, Implementation Decision, complete implementation instructions

**Submission**:
The point-in-time act of asking But Why to return an exact completed publication when it remains ready or otherwise fetch the Change Base, inspect a Change's Managed Worktree, select its Candidate or unchanged state, validate a changed Candidate, and publish when eligible.
Submission checks completed publication evidence before it fetches a newer Change Base or resolves current configuration.
Later Change Base advancement does not alter a completed Submission or invalidate its Candidate automatically.
_Avoid_: Push, Candidate, Validation Run, continuous merge gate

**Terminal Cleanup**:
The one idempotent Change-owned cleanup operation that runs for a Closed Change after completion or cancellation and retries on repeated cancellation and reconciliation.
It cleans the Managed Worktree, local Repository Branch, and Remote Change Branch and invokes the Artifact lifecycle owner to remove Artifact Content for the exact terminal Change.
Cleanup stays pending and retryable when resource or Artifact Content cleanup cannot complete.
_Avoid_: Generic cleanup framework, per-caller cleanup orchestration, worktree removal alone

**Discard Work**:
The exact one-attempt terminal cleanup authority supplied only by `by change reconcile <exact-change-id> --discard-work`.
It abandons all work in the selected Closed Change's recorded resources, including dirty Managed Worktree content, unique Repository Branch work, and a changed Remote Change Branch.
It preserves exact resource identity and deletes the Remote Change Branch only when it still matches the head read during that attempt.
It is not persisted.
_Avoid_: Generic cleanup permission, Implementation Authorization, discard history

**No-Change Submission**:
A Submission whose Repository Branch has the same tracked file tree as the exact fetched Change Base after the ancestry check passes.
A No-Change Submission returns `nothing_to_submit`, keeps its Task and Change open, and does not run validation.
_Avoid_: Empty commit, comparison with the Change's starting tree, caller assertion

**Finding**:
An immutable report that states one material problem and its evidence from Prepare, a Check, Acceptance Review, or a Specialist for one Candidate review.
Every Finding is blocking, so it has no severity classification.
_Avoid_: Tooling Failure, mutable issue

**Implementation Decision**:
An immutable Implementer-authored record of one material choice and its reasoning during a Change.
Implementation Decisions are non-authoritative rationale supplied separately from Acceptance Context.
_Avoid_: Acceptance Context amendment, ADR, Finding

**Implementation Blocker**:
An immutable Implementer-authored problem report for one Open Change when implementation cannot safely continue under the accepted intent without an external decision or action.
At most one unresolved Implementation Blocker may exist for an open Change.
The unresolved Blocker row is the active authority for blocked Change activity and remains available after publication or an earlier passing Candidate.
Blocker operations do not write or depend on blocked Change or Task lifecycle state.
_Avoid_: Finding, Validation Tooling Failure, Task Dependency, Implementation Decision, cancellation

**Implementation Blocker Resolution**:
A user-approved answer to one active Implementation Blocker.
The Resolution record remains immutable Change history and is not classified by whether it changes intent.
For a Change linked to a Task, the Resolution becomes part of the current Acceptance Context through derivation from the immutable initial snapshot and ordered Resolution records.
A Resolution for a Change without a Task creates no Acceptance Context or Acceptance Review input.
_Avoid_: Implementation Decision, silent Task edit, automatic recovery

**Validation Gate**:
The fixed read-only sequence that judges changed code through Repository Preparation, Checks, Acceptance Review for a Change linked to a Task, and configured Specialists.
_Avoid_: Generic pipeline language, publication, implementation

**Validation Phase Result**:
One immutable persisted result for a configured phase and Producer in one Validation Run.
It stores the outcome and compact Finding, Artifact, and Tooling Failure evidence produced at that position.
_Avoid_: Validation Run, retry attempt, mutable result

**Acceptance Reviewer**:
The coding agent that owns the overall judgment of whether a Candidate satisfies supplied Acceptance Context.
It may require missing work necessary for approved intent, but it does not expand approved intent or require optional improvement.
_Avoid_: Specialist Reviewer, Implementer

**Specialist Reviewer**:
A configured coding agent that judges one named repository concern for the exact Candidate.
It owns only its configured concern and does not investigate or report concerns outside that responsibility.
When supplied Acceptance Context, it uses that context only as an authoritative scope constraint.
It may judge whether available verification evidence is defective within its concern, but it requires a particular verification mechanism only when approved intent or the concern's owning boundary requires it.
_Avoid_: Acceptance Reviewer, Final Reviewer

**Snapshot Workspace**:
A disposable detached Git worktree in which one Validation Run judges the exact Candidate without changing it.
Each Snapshot Workspace uses the Local Repository's sibling But Why worktree root and belongs to one Validation Run, expected commit, and deterministic path derived from the Validation Run identity.
Cleanup verifies the safe But Why-owned path, the exact Local Repository worktree registration, and the exact live HEAD.
A later Validation Run uses a different Snapshot Workspace.
Recovery may reuse only the same Validation Run's matching clean Snapshot Workspace.
Snapshot Workspaces provide no security isolation.
_Avoid_: Managed Worktree, Task Worktree, Interactive Session

**Validation Tooling Failure**:
A failure in But Why or its validation tooling that prevents a trustworthy judgment of the Candidate.
_Avoid_: Finding, failed Check result
