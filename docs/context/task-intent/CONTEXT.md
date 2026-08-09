# Task Intent Context

This context owns requested intent, approval, dependencies, and user-facing Task progress.

## Language

**Work Route Selection**:
The Operator's explicit choice to handle requested repository work through a Task-backed Change, a taskless Change, or a direct edit outside But Why.
An agent may recommend a route but must not substitute another route after the Operator decides.
When the selected route conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent, the agent reports the conflict and requests direction through the applicable authority mechanism.
_Avoid_: Agent-selected workflow, Task Approval, Change Start

**Task Recording Authorization**:
The Operator's explicit permission to persist one proposed set of Task Contexts and Task Dependencies.
It does not authorize Task Submission, Task Approval, Change Start, or Implementation Authorization.
_Avoid_: Task Submission, Task Approval, approval to implement, automatic Change Start

**Task**:
The durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
_Avoid_: Change, issue draft, implementation session

**Task Context**:
The current Task title and description before Change Start.
_Avoid_: Acceptance Context, operational metadata

**Task Verification Contract**:
The Task Context section that identifies Material Risks, required Verification Claims and evidence, escalation conditions, and explicit exclusions for implementation confidence.
It is preserved in Acceptance Context when the Task starts.
_Avoid_: Validation Policy Snapshot, Check list, coverage target

**Task Context Draft**:
A disposable editable copy of Task Context prepared before its proposed changes are applied.
_Avoid_: Task Worktree, durable Task Context, Artifact

**Task Slug**:
The canonical filesystem-safe operational name derived from a Task ID.
_Avoid_: Display title, raw Task ID in process names

**Task Submission Authorization**:
The Operator's explicit permission to submit one exact presented Task Context and direct Task Dependency set for Task Review.
It covers only that exact proposal and does not authorize a changed proposal, Task Recording, Change Start, or Implementation Authorization.
The CLI does not persist Task Submission Authorization.
_Avoid_: Task Recording Authorization, Task Approval, Implementation Authorization

**Task Submission**:
The synchronous operation that runs one fresh advisory Task Review for an unlinked New Task.
Passed, Finding-blocked, and tooling-failed outcomes leave the Task New.
_Avoid_: Task Approval, Change Submission

**Task Review**:
The durable active or completed advisory Review of one exact Task proposal against repository evidence by one Task Reviewer.
Its proposal identity contains only the complete Task Context and canonical direct Task Dependency ID set.
Its point-in-time dependency evidence, Review Base, and built-in reviewer policy are separate immutable evidence.
_Avoid_: Validation Run, Candidate validation, generic Review domain

**Task Reviewer**:
The Agent Profile with the built-in instructions that judges one Task proposal.
_Avoid_: Candidate Reviewer, Specialist Reviewer, generic reviewer framework

**Task Approval**:
The Operator's explicit confirmation that recorded Task intent can move from New to Todo.
A Task Review is advisory and does not grant Task Approval.
Task Context and Task Dependencies become immutable at Task Approval.
_Avoid_: Task Submission, Change Start, Implementation Authorization

**Task Lifecycle**:
The user-facing progress of a Task through New, Todo, Done, or Cancelled.
Todo means approved and unfinished, even while a linked Change reports Change Activity.
_Avoid_: Validation Run state, generic pipeline

**Transient Task State**:
A retired persisted Task-state value other than New, Todo, Done, or Cancelled.
It has no current lifecycle meaning and a migration stops rather than mapping it to a supported state.
_Avoid_: Change Activity, active Task state

**Task Dependency**:
A directed prerequisite relationship required because the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
Related work, shared files, likely conflicts, preferred sequence, and relative importance do not establish a Task Dependency.
_Avoid_: Queue priority, implementation preference, Git base relationship
