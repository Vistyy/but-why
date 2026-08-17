# Task Intent Context

This context owns requested intent, Task Submission, dependencies, and user-facing Task progress.

Task/Change coordination is the only application boundary that may cross Task and Change state.
Task state transitions remain Task-owned, and an unlinked Task cannot become Done.
A linked Task becomes Done only when coordination records exact merged evidence for its linked Change.

## Language

**Work Route Selection**:
The Operator's explicit choice to handle requested repository work through a Change linked to a Task, a Change without a Task, or a direct edit outside But Why.
An agent may recommend a route but must not substitute another route after the Operator decides.
When the selected route conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent, the agent reports the conflict and requests direction through the applicable authority mechanism.
_Avoid_: Agent-selected workflow, Task Submission, Change Start

**Task Recording Authorization**:
The Operator's explicit permission to persist agreed Task outcomes and their actual Task Dependencies for selected work.
It permits clear Task description wording and dependency encoding within the agreed scope.
It does not authorize Task Submission, Change Start, or Implementation Authorization.
_Avoid_: Approval of exact prose, Task Submission Authorization, approval to implement, automatic Change Start

**Task Submission Authorization**:
The Operator's explicit permission to submit one selected New Task proposal for Task Review toward a passing Task Review and transition to Todo.
It is not persisted.
Another submission requires new Task Submission Authorization for the selected Task.
It does not authorize Change Start or implementation.
_Avoid_: Task Recording Authorization, Task Review, reusable judgment

**Task**:
The durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
A Task has a SQLite-allocated internal integer identity, and its public ID is `<id-prefix>-<task-integer>`.
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

**Task Review**:
One review of one exact Task proposal submitted from New.
The proposal identity is the complete selected Task Context and exact direct Task Dependency set.
A Task Review captures dependency evidence, a Review Base, and the immutable effective Task Review policy, and it ends as passed, blocked by Findings, or tooling failed.
The effective policy contains the mandatory built-in review core, the resolved Agent Profile configuration, and at most one optional Repo or Global guidance file.
When no reusable judgment exists, a Task Review can continue the most recent compatible usable Task Agent Session but always receives and judges the complete current proposal.
Passing completion approves the exact reviewed Task atomically by moving it from New to Todo.
Ordinary Task Submission selects the newest completed Review for the exact unchanged New Task proposal and reuses it only when it passed.
Finding-blocked and tooling-failed Reviews remain history and are not reusable judgments.
A later authorized submission of an unchanged New Task proposal runs a new Task Review.
Context and direct Task Dependency identity are the only reuse identity fields.
Repository state, Review Base, policy, configuration, dependency content, and dependency lifecycle do not affect reuse.
_Avoid_: Task Submission, Acceptance Review, Validation Run

**Task Agent Session**:
An Agent Session owned by one Task under one compatible resolved Task Review policy.
It can continue across changed proposals so the reviewer can reuse repository orientation, but it does not reuse an earlier judgment.
_Avoid_: Task Review, cross-Task Agent Session, reusable judgment

**Task Agent Transcript**:
The complete Pi session conversation observed while executing a Task Agent Session.
The Agent Continuation stores its relative transcript path when the transcript is available.
_Avoid_: Task Review outcome, Finding, retention-limited Artifact

**Active Task Review**:
The sole running Task Review for one Task until it completes or the Operator abandons it.
It prevents another Task Submission for that Task.
A New Task proposal can change while its ordinary Review runs, but the changed proposal prevents that Review from approving the Task.
_Avoid_: Task state, process lock, Active Validation Run

**Task Review Proposal**:
The exact Task title, description, and direct Task Dependency identities selected by Task Submission.
Captured dependency Context and lifecycle facts are evidence for that review and do not alter proposal identity.
_Avoid_: Acceptance Context, dependency evidence, Task revision

**Review Base**:
The canonical main checkout branch ref and exact commit captured for one Task Review.
Repository Preparation and reviewer execution use a disposable exact workspace at that commit.
_Avoid_: Change Base, caller checkout HEAD, Candidate

**Task Revision**:
The transition that returns an unlinked Todo Task to New before the Operator changes its approved intent.
It preserves Task Context, direct Task Dependencies, and historical Task Review evidence.
Revision of an unlinked New Task without an Active Task Review is an idempotent no-op.
A Change-linked Task, an Active Task Review of a New Task, or a terminal Task state prevents revision.
_Avoid_: proposal identity change, Revision record

**Task Lifecycle**:
The user-facing progress of a Task through New, Todo, Done, or Cancelled.
Todo means approved and unfinished, even while a linked Change reports Change Activity.
A Task without a link cannot transition to Done.
Coordination records the Done transition for a linked Task only after exact merged Change evidence.
_Avoid_: Validation Run state, Change Activity, generic pipeline

**Task Dependency**:
A directed prerequisite relationship required because the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
Related work, shared files, likely conflicts, preferred sequence, and relative importance do not establish a Task Dependency.
_Avoid_: Queue priority, implementation preference, Git base relationship
