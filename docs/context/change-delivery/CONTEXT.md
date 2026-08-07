# Change Delivery Context

This context owns code lineage, implementation, Candidate selection, validation, publication, reconciliation, and Change completion.

## Language

**Change**:
The durable owner of one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and owned pull request, optionally linked to one Task.
_Avoid_: Task, branch, pull request, generic workflow

**Task-backed Change**:
A Change linked to one Task and its Acceptance Context.
_Avoid_: Task, Task Worktree

**Taskless Change**:
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

**Transient Change State**:
The retired persisted Change-state value `blocked`.
It has no current lifecycle meaning and a migration stops rather than mapping it to Open or Closed.
_Avoid_: Blocked Change, Change Activity

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
Publication requires complete, passed evidence that exactly matches the current Candidate, Change Base, Acceptance Context when present, Validation Policy Snapshot, Implementation Decisions, and latest resolved Implementation Blocker identity.
Fresh passing evidence for the same Candidate already on the owned pull request records the new Validation Run without artificial republication.
Current publication facts record the exact Candidate, Validation Run, target, head branch, expected head commit, and owned pull request.
A changed Candidate invalidates current publication until that Candidate is on the owned pull request.
_Avoid_: Current Candidate, mutable pull request state, Submission

**Exact Merged Candidate**:
An Exact Merged Candidate is the Candidate in current publication.
Its owned pull request is observed as closed and merged with matching repository, base branch, head branch, head commit, and pull request identity.
It is the only external evidence that can complete the Change and, when present, its linked Task.
_Avoid_: Merged pull request, historical Candidate, current Candidate

**Acceptance Context**:
One immutable version of approved intent.
A task-backed Change captures its initial version from the approved Task when the Task starts.
Acceptance Review uses supplied Acceptance Context as review authority.
A Specialist Review that receives Acceptance Context uses it only as an authoritative scope constraint.
A Task-backed Implementation Blocker Resolution appends the Resolution to the current Acceptance Context.
A taskless Resolution remains Change history and creates no Acceptance Context.
A Validation Run retains the exact Acceptance Context it used through its Validation Policy Snapshot.
_Avoid_: Current mutable Task text, Specialist instructions, inferred intent, Implementation Blocker report

**Validation Run**:
One durable execution and judgment of one Candidate under one resolved validation policy.
Validation persistence admits a new Run only when no unresolved Implementation Blocker exists for the Change, and it keeps at most one Active Validation Run per Change.
Each Validation Run records the exact Candidate, the Validation Policy Snapshot including the current Acceptance Context when present, the Implementation Decision input, and the latest resolved Implementation Blocker identity at admission.
Reuse and publication require the exact Candidate, Change Base, current Acceptance Context when present, Validation Policy Snapshot, Implementation Decision input, and latest resolved Implementation Blocker identity, plus Run state `complete` and outcome `passed`.
A changed Candidate, Resolution, Acceptance Context, policy, or implementation input invalidates current validity without deleting historical evidence.
For a taskless Change, a later Resolution makes earlier Runs historical without creating Acceptance Context or Acceptance Review input.
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
The ordered immutable Validation Runs retained for one Change and its Candidates.
_Avoid_: Mutable current report

**Validation Policy Snapshot**:
The immutable resolved Prepare, Checks, reviewer instructions, Agent Profiles, and output contract used by one Validation Run.
Later configuration changes do not alter the snapshot or its historical Validation Run, and Validation Run reuse requires an exact snapshot match.
_Avoid_: Mutable current config, raw config hash, retroactive policy

**Reviewer Session**:
A continuing reviewer conversation owned by one Change and one Reviewer Session identity.
It can resume across that Change's Candidates and disposable Validation Workspaces so a reviewer can reuse repository orientation.
_Avoid_: Fresh reviewer session per Candidate, cross-Change reviewer conversation

**Reviewer Transcript**:
The complete Pi session conversation produced by one Reviewer Session.
It is retained after its Change closes as debugging and improvement evidence.
_Avoid_: Review report, reviewer stdout, security audit trail

**Reviewer Transcript Reference**:
The immutable persisted record of one retained Reviewer Transcript, identifying its exact Change, Reviewer Producer, Pi session ID, and file path relative to the per-producer reviewer-session root.
Terminal Cleanup records one reference per retained JSONL file and never removes historical references.
_Avoid_: Active Reviewer Session record, transcript copy, transcript move, CLI output

**Reviewer Session Usability**:
The Reviewer Agent Runtime classification after a failed resumed review.
`unusable` means the stored Reviewer Session is proven unable to continue, while `unknown` means the failure does not establish that the stored session is unusable and the session remains preserved.
_Avoid_: Provider error message, automatic retry status

**Producer**:
The named source of validation evidence, such as Prepare, a Check, Acceptance Review, or a Specialist Review.
A Producer identifies the source that creates an Artifact or Finding.
_Avoid_: Agent Profile, Reviewer Session, Validation Run

**Reviewer Producer**:
A Producer identifier for an Acceptance Reviewer or Specialist Reviewer that owns a continuing Reviewer Session.
_Avoid_: Agent Profile, generic validation phase, cross-Change reviewer

**Reviewer Session Identity**:
The Change, Reviewer Producer, resolved Agent Profile, reviewer instructions, Agent Environment, and curated resources that determine whether a Reviewer Session can safely continue.
Its fingerprint is the sole persisted compatibility identity.
_Avoid_: Session file path, Candidate identity, Validation Run identity

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
It may link an approved Task and capture its Acceptance Context.
_Avoid_: Agent launch alone, validation, arbitrary state assignment

**Implementation Authorization**:
The Operator's explicit permission to begin implementing one selected work item through its selected Work Route.
Task Recording Authorization and Task Approval do not grant it.
It applies to Task-backed Changes, taskless Changes, and direct edits.
For a Task-backed Change, Implementation Authorization requires starting or verifying a fresh Implementer Interactive Session.
For taskless work, implementation remains in the current session unless Implementation Authorization explicitly requests a fresh Implementer Interactive Session.
_Avoid_: Task Approval, Task Recording Authorization, inferred permission to implement, authorization for unrelated work

**Managed Worktree**:
The persistent But Why-owned Git branch and linked worktree belonging to one open Change.
_Avoid_: Validation Workspace, caller checkout, temporary agent worktree, Task Worktree

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
The point-in-time act of asking But Why to fetch the Change Base, inspect a Change's Managed Worktree, select its Candidate or unchanged state, validate a changed Candidate, and publish when eligible.
Later Change Base advancement does not alter a completed Submission or invalidate its Candidate automatically.
_Avoid_: Push, Candidate, Validation Run, continuous merge gate

**Terminal Cleanup**:
The one idempotent Change-owned cleanup operation that runs for a Closed Change after completion or cancellation and retries on repeated cancellation and reconciliation.
It indexes every retained Reviewer Session JSONL file into immutable Reviewer Transcript References, covers the Managed Worktree, local Repository Branch, and Remote Change Branch, and invokes the Reviewer Session and Artifact lifecycle owners for the exact terminal Change.
Cleanup stays pending and retryable when transcript indexing cannot complete.
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
For a Task-backed Change, the Resolution appends to the current Acceptance Context.
A taskless Resolution creates no Acceptance Context or Acceptance Review input.
_Avoid_: Implementation Decision, silent Task edit, automatic recovery

**Validation Gate**:
The fixed read-only sequence that judges changed code through Repository Preparation, Checks, Acceptance Review for a Task-backed Change, and configured Specialists.
_Avoid_: Generic pipeline language, publication, implementation

**Acceptance Reviewer**:
The coding agent that owns the overall judgment of whether a Candidate satisfies supplied Acceptance Context, including its Task Verification Contract.
It may require missing work necessary for approved intent, but it does not expand approved intent or require optional improvement.
_Avoid_: Specialist Reviewer, Implementer

**Specialist Reviewer**:
A configured coding agent that judges one named repository concern for the exact Candidate.
It owns only its configured concern and does not investigate or report concerns outside that responsibility.
When supplied Acceptance Context, it uses that context only as an authoritative scope constraint.
It may judge whether existing verification evidence is defective within its concern, but it does not require evidence beyond a supplied Task Verification Contract or argue against an approved verification decision.
_Avoid_: Acceptance Reviewer, Final Reviewer

**Validation Workspace**:
An isolated disposable workspace in which one Validation Run judges the exact Candidate without changing it.
A later Validation Run uses a different Validation Workspace.
Recovery may reuse only the same Validation Run's matching clean Validation Workspace.
_Avoid_: Task Worktree, Interactive Session

**Validation Tooling Failure**:
A failure in But Why or its validation tooling that prevents a trustworthy judgment of the Candidate.
_Avoid_: Finding, failed Check result
