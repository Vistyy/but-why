# Task Intent Context

This context owns requested intent, planning judgment, approval, dependencies, and user-facing Task progress.

## Language

**Work Route Selection**:
The Operator's explicit choice to handle requested repository work through a Task-backed Change, a taskless Change, or a direct edit outside But Why.
An agent may recommend a route but must not substitute another route after the Operator decides.
When the selected route conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent, the agent reports the conflict and requests direction through the applicable authority mechanism.
_Avoid_: Agent-selected workflow, Task Approval, Change Start

**Task Recording Authorization**:
The Operator's explicit permission to persist one proposed set of Task Contexts and Task Dependencies.
It does not authorize Task Approval, Change Start, or an implementation handoff.
_Avoid_: Task Approval, approval to implement, automatic Change Start

**Task**:
The durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
_Avoid_: Change, issue draft, implementation session

**Task Context**:
The current Task title, description, and ordered comments before Change Start.
_Avoid_: Acceptance Context, operational metadata

**Task Verification Contract**:
The Task Context section that identifies Material Risks, required Verification Claims and evidence, escalation conditions, and explicit exclusions for implementation confidence.
It is preserved in Acceptance Context when the Task starts.
_Avoid_: Validation Policy Snapshot, Check list, coverage target

**Task Comment**:
An ordered Markdown addition to Task Context before Change Start.
_Avoid_: Finding, cancellation reason, Implementation Decision

**Task Context Draft**:
A disposable editable copy of Task Context prepared before its proposed changes are applied.
_Avoid_: Task Worktree, durable Task Context, Artifact

**Task Slug**:
The canonical filesystem-safe operational name derived from a Task ID.
_Avoid_: Display title, raw Task ID in process names

**Task Submission**:
The point-in-time operation that asks But Why to judge one Planning Proposal Snapshot against one Planning Base and resolved planning policy.
Explicit resubmission of a Todo Task under a different policy or invalid Planning Base replaces its prior approval only after preflight succeeds.
_Avoid_: Task Approval, Change Submission, Task edit

**Planning Proposal Snapshot**:
The immutable Task Context, dependency edges, and exact direct-related-Task evidence supplied to one Planning Run.
A concurrent change to that evidence makes an active Task Submission stale before approval.
_Avoid_: Acceptance Context, mutable Task view, repository evidence

**Planning Base**:
The exact local default-branch commit and tree against which one Planning Run judges a Task proposal.
_Avoid_: Change Base, remote default branch, arbitrary caller HEAD

**Planning Run**:
One durable execution and judgment of one Task proposal under one resolved planning policy that begins only after Task Submission eligibility and preflight succeed.
A passed or Finding-blocked Planning Run is reusable while its proposal and policy match and its Planning Base remains valid.
_Avoid_: Validation Run, Task Submission attempt, generic job

**Active Planning Run**:
The sole running Planning Run durably related to one Task until it completes or an operator explicitly abandons it.
Its Task cannot be cancelled while it remains active.
_Avoid_: Process lock, reviewer process, current Task Submission

**Planning Run Abandonment**:
The explicit operator recovery that completes an interrupted Active Planning Run as tooling-failed after its processes stop and its exact resources are handled.
_Avoid_: Automatic cleanup, process termination, cancellation

**Planning Run State**:
The state of a Planning Run: running or complete.
_Avoid_: Task state, review result

**Planning Run Outcome**:
The completed result of a Planning Run: passed, blocked by Planning Findings, or failed because of tooling.
_Avoid_: Task state, reviewer status, abandonment

**Planning Run History**:
The ordered immutable Planning Runs retained for one Task.
_Avoid_: Mutable planning report, Task comments

**Planning Policy Snapshot**:
The immutable resolved Repository Preparation, Planning Reviewer instructions, Agent Profile, Agent Environment, and output contract used by one Planning Run.
Later configuration changes do not alter the snapshot or its historical Planning Run, and Planning Run reuse requires an exact snapshot match.
_Avoid_: Mutable current config, raw config hash, Validation Policy Snapshot

**Planning Reviewer**:
The coding agent that judges whether one Task proposal is ready for implementation against repository and authoritative external evidence.
_Avoid_: Acceptance Reviewer, Implementer, Task approver

**Planning Reviewer Session**:
A continuing reviewer conversation owned by one Task and resumed across its Planning Runs and disposable Planning Workspaces.
_Avoid_: Fresh reviewer session per Task Submission, cross-Task reviewer conversation

**Planning Reviewer Session Identity**:
The Task, Planning Reviewer producer, resolved Agent Profile, reviewer instructions, Agent Environment, and configured resources that determine whether a Planning Reviewer Session can safely continue.
The Planning Base, Planning Proposal Snapshot, and Planning Run do not belong to this identity.
_Avoid_: Planning Run identity, session file path, mutable Task proposal

**Planning Finding**:
An immutable report that states one material problem and the evidence that prevents approval of the reviewed Task proposal.
Every Planning Finding is blocking, so it has no severity classification.
_Avoid_: Task Comment, implementation detail, optional refinement

**Planning Workspace**:
An isolated disposable workspace in which one Planning Run judges its exact Planning Base without changing it.
_Avoid_: Validation Workspace, Managed Worktree, caller checkout

**Planning Tooling Failure**:
A failure after Planning Run creation in But Why or its planning tooling that prevents a trustworthy judgment of the Task proposal.
Preflight rejection is not a Planning Tooling Failure.
_Avoid_: Planning Finding, reviewer rejection

**Task Approval**:
The current confirmation that one exact Planning Proposal Snapshot passed Planning Review under its recorded Planning Policy Snapshot and Planning Base.
Configuration changes do not invalidate it automatically, but explicit Task resubmission can replace it after preflight succeeds.
_Avoid_: Change Start, permanent approval, operator-only assertion

**Task Lifecycle**:
The user-facing progress of a Task through New, Todo, Implementing, Blocked, Validating, Ready, Done, or Cancelled.
_Avoid_: Validation Run state, generic pipeline

**Task Dependency**:
A directed prerequisite relationship required because the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
An unfinished prerequisite does not prevent Task Submission, but Planning Review can report a Planning Finding when that prerequisite prevents trustworthy planning.
Related work, shared files, likely conflicts, preferred sequence, and relative importance do not establish a Task Dependency.
_Avoid_: Queue priority, implementation preference, Git base relationship
