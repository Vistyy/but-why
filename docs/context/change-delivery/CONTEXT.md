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

**Blocked Change**:
A temporary Change state caused by one active Implementation Blocker.
A Blocked Change cannot be submitted and returns to Open when its blocker is resolved.
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

**Acceptance Context**:
One immutable version of the approved Task intent.
For a task-backed Change, Acceptance Review uses it as review authority and each Specialist Review uses it as an authoritative scope constraint.
The initial version is captured when the Task starts.
Each approved Implementation Blocker Resolution creates a new version by appending the Resolution to the original approved intent and earlier Resolutions.
A Validation Run retains the exact Acceptance Context version it reviewed.
_Avoid_: Current mutable Task text, Specialist instructions, inferred intent, Implementation Blocker report

**Validation Run**:
One durable execution and judgment of one Candidate under one resolved validation policy.
Only a passed Validation Run is reusable because unchanged validation can produce new execution evidence.
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
_Avoid_: Mutable current report, Task comments

**Validation Policy Snapshot**:
The immutable resolved Prepare, Checks, reviewer instructions, Agent Profiles, and output contract used by one Validation Run.
Later configuration changes do not alter the snapshot or its historical Validation Run, and Validation Run reuse requires an exact snapshot match.
_Avoid_: Mutable current config, raw config hash, retroactive policy

**Reviewer Session**:
A continuing reviewer conversation owned by one Change and one Reviewer Session identity.
It can resume across that Change's Candidates and disposable Validation Workspaces so a reviewer can reuse repository orientation.
_Avoid_: Fresh reviewer session per Candidate, cross-Change reviewer conversation

**Producer**:
The named source of validation evidence, such as Prepare, a Check, Acceptance Review, or a Specialist Review.
A Producer identifies the source that creates an Artifact or Finding.
_Avoid_: Agent Profile, Reviewer Session, Validation Run

**Reviewer Producer**:
A Producer identifier for an Acceptance Reviewer or Specialist Reviewer that owns a continuing Reviewer Session.
_Avoid_: Agent Profile, generic validation phase, cross-Change reviewer

**Reviewer Session Identity**:
The Change, Reviewer Producer, resolved Agent Profile, reviewer instructions, Agent Environment, and curated resources that determine whether a Reviewer Session can safely continue.
_Avoid_: Session file path, Candidate identity, Validation Run identity

**Artifact**:
A durable reference to bounded validation evidence with explicit Run, phase, producer, storage, and truncation metadata.
_Avoid_: Untracked file, copied secret content, console-only output

**Change Start**:
The operation that creates a Change, its Managed Worktree, and its starting commit.
It may link an approved Task and capture its Acceptance Context.
_Avoid_: Agent launch alone, validation, arbitrary state assignment

**Managed Worktree**:
The persistent But Why-owned Git branch and linked worktree belonging to one open Change.
_Avoid_: Validation Workspace, caller checkout, temporary agent worktree, Task Worktree

**Interactive Session**:
An optional visible external-agent process hosted in a Managed Worktree, with Herdr as the current v1 integration.
_Avoid_: Task state, Validation Run, background Supervisor worker

**Implementer**:
The coding agent that changes a Change's Managed Worktree and may author Implementation Decisions or Implementation Blockers.
_Avoid_: Acceptance Reviewer, Specialist Reviewer, reviewer process

**Implementation Advisor**:
An optional background agent within an Implementer's Interactive Session that observes completed implementation activity and emits non-blocking advice without changing repository state, controlling the Implementer, or owning session continuation.
_Avoid_: Implementer, reviewer, continuation worker

**Submission**:
The point-in-time act of asking But Why to fetch the Change Base, inspect a Change's Managed Worktree, select its Candidate or no-change state, validate it, and publish when eligible.
Later Change Base advancement does not alter a completed Submission or invalidate its Candidate automatically.
_Avoid_: Push, Candidate, Validation Run, continuous merge gate

**No-Change Submission**:
A Submission whose Repository Branch has the same tracked file tree as the exact fetched Change Base after the ancestry check passes.
A Task-backed No-Change Submission runs Acceptance Review and can complete without a pull request.
A taskless no-change result remains open.
_Avoid_: Empty commit, comparison with the Change's starting tree, caller assertion

**Finding**:
An immutable report that states one material problem and its evidence from Prepare, a Check, Acceptance Review, or a Specialist for one Candidate or no-change review.
Every Finding is blocking, so it has no severity classification.
_Avoid_: Tooling Failure, Task Comment, mutable issue

**Implementation Decision**:
An immutable Implementer-authored record of one material choice and its reasoning during a Change.
Implementation Decisions are non-authoritative rationale supplied separately from Acceptance Context.
_Avoid_: Task Comment, Acceptance Context amendment, ADR, Finding

**Implementation Blocker**:
An immutable Implementer-authored problem report for one Open Change when implementation cannot safely continue under the accepted intent without an external decision or action.
An active Implementation Blocker moves a Change and its linked Task to Blocked and prevents Submission until it is resolved or the work is cancelled.
_Avoid_: Finding, Validation Tooling Failure, Task Dependency, Implementation Decision, cancellation

**Implementation Blocker Resolution**:
A user-approved answer to one active Implementation Blocker that returns the Change to Open.
For a Task-backed Change, the Resolution succeeds only when the linked Task is Blocked, returns the Task to Implementing, and creates a new Acceptance Context version.
_Avoid_: Implementation Decision, Task Comment, silent Task edit, automatic recovery

**Validation Gate**:
The fixed read-only sequence that judges changed code through Repository Preparation, Checks, Acceptance Review for a Task-backed Change, and configured Specialists.
_Avoid_: Generic pipeline language, publication, implementation

**Acceptance Reviewer**:
The coding agent that owns the overall judgment of whether a Task-backed Change's Candidate or no-change repository state satisfies immutable Acceptance Context, including its Task Verification Contract.
_Avoid_: Specialist Reviewer, Implementer

**Specialist Reviewer**:
A configured coding agent that judges one named repository concern for the exact Candidate.
For a task-backed Change, it uses Acceptance Context only as an authoritative scope constraint and does not duplicate the Acceptance Reviewer's overall conformance judgment.
It may judge whether existing verification evidence is defective within its concern, but it does not require evidence beyond the Task Verification Contract.
_Avoid_: Acceptance Reviewer, Final Reviewer

**Validation Workspace**:
An isolated disposable workspace in which one Validation Run judges the exact Candidate without changing it.
_Avoid_: Task Worktree, Interactive Session

**Validation Tooling Failure**:
A failure in But Why or its validation tooling that prevents a trustworthy judgment of the Candidate.
_Avoid_: Finding, failed Check result
