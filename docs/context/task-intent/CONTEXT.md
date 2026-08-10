# Task Intent Context

This context owns requested intent, approval, dependencies, and user-facing Task progress.

## Language

**Work Route Selection**:
The Operator's explicit choice to handle requested repository work through a Task-backed Change, a taskless Change, or a direct edit outside But Why.
An agent may recommend a route but must not substitute another route after the Operator decides.
When the selected route conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent, the agent reports the conflict and requests direction through the applicable authority mechanism.
_Avoid_: Agent-selected workflow, Task Approval, Change Start

**Task Recording Authorization**:
The Operator's explicit permission to persist agreed Task outcomes and their actual Task Dependencies for selected work.
It permits clear Task description wording and dependency encoding within the agreed scope.
It does not authorize Task Approval, Change Start, or Implementation Authorization.
_Avoid_: Approval of exact prose, Task Approval, approval to implement, automatic Change Start

**Task**:
The durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
_Avoid_: Change, issue draft, implementation session

**Task Context**:
The current Task title and freeform description before Change Start.
The description has no required section structure.
_Avoid_: Acceptance Context, operational metadata

**Task Context Draft**:
A disposable editable copy of a Task description prepared before the description is applied.
Applying it preserves the Task title.
_Avoid_: Task Worktree, durable Task Context, Artifact

**Task Slug**:
The canonical filesystem-safe operational name derived from a Task ID.
_Avoid_: Display title, raw Task ID in process names

**Task Approval**:
The Operator's explicit confirmation that recorded Task intent can move from New to Todo.
V1 represents approval through Todo and does not maintain a separate approval snapshot or revalidation lifecycle.
Task Context and Task Dependencies become immutable at Task Approval.
_Avoid_: Change Start, Implementation Authorization

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
