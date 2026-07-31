# But Why Domain Context

This glossary defines canonical language for the Change-centered v1 system.
`docs/architecture.md` documents current ownership and workflow behavior.
Detailed behavior belongs in executable sources, accepted ADRs, and SQLite Tasks.

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

**Local Repository**:
One Git repository identity shared by its main checkout and linked worktrees.
_Avoid_: Current working directory, GitHub repository

**Git Common Directory**:
The canonical Git-controlled directory shared by every worktree of one Local Repository.
_Avoid_: Worktree root, Repo Config location, per-worktree Git directory

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
One immutable version of the approved Task intent supplied only to Acceptance Review.
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

**Task**:
The durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
_Avoid_: Change, issue draft, implementation session

**Task Context**:
The current Task title, description, and ordered comments before Change Start.
_Avoid_: Acceptance Context, operational metadata

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
Explicit resubmission of a Todo Task whose Planning Base is no longer valid returns it to New until a new Planning Run passes.
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
The immutable resolved Repository Preparation, Planning Reviewer instructions, Agent Profile, and output contract used by one Planning Run.
Later configuration changes do not alter the snapshot or its historical Planning Run, and Planning Run reuse requires an exact snapshot match.
_Avoid_: Mutable current config, raw config hash, Validation Policy Snapshot

**Planning Reviewer**:
The coding agent that judges whether one Task proposal is ready for implementation against repository and authoritative external evidence.
_Avoid_: Acceptance Reviewer, Implementer, Task approver

**Planning Reviewer Session**:
A continuing reviewer conversation owned by one Task and resumed across its Planning Runs and disposable Planning Workspaces.
_Avoid_: Fresh reviewer session per Task Submission, cross-Task reviewer conversation

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
The current confirmation that one exact Planning Proposal Snapshot passed Planning Review against its recorded Planning Base.
It becomes invalid when that Planning Base is no longer an ancestor of the fetched Change Base.
_Avoid_: Change Start, permanent approval, operator-only assertion

**Change Start**:
The operation that creates a Change, its Managed Worktree, and its starting commit.
It may link an approved Task and capture its Acceptance Context.
_Avoid_: Agent launch alone, validation, arbitrary state assignment

**Task Lifecycle**:
The user-facing progress of a Task through New, Todo, Implementing, Blocked, Validating, Ready, Done, or Cancelled.
_Avoid_: Validation Run state, generic pipeline

**Task Dependency**:
A directed prerequisite relationship required because the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
An unfinished prerequisite does not prevent Task Submission, but Planning Review can report a Planning Finding when that prerequisite prevents trustworthy planning.
Related work, shared files, likely conflicts, preferred sequence, and relative importance do not establish a Task Dependency.
_Avoid_: Queue priority, implementation preference, Git base relationship

**Shared Repository State**:
SQLite and other local operational state resolved through Git's common directory so every linked worktree sees the same facts.
_Avoid_: Copied state file, tracked Repo Config, per-worktree database

**Migration Artifact**:
One numbered source artifact that defines an ordered Shared Repository State migration.
Existing Migration Artifacts are immutable, and a schema change adds the next Migration Artifact.
_Avoid_: Migration file, migration script, editable migration

**Managed Worktree**:
The persistent But Why-owned Git branch and linked worktree belonging to one open Change.
_Avoid_: Validation Workspace, caller checkout, temporary agent worktree, Task Worktree

**Interactive Session**:
An optional visible external-agent process hosted in a Managed Worktree, with Herdr as the current v1 integration.
_Avoid_: Task state, Validation Run, background Supervisor worker

**Implementer**:
The coding agent that changes a Change's Managed Worktree and may author Implementation Decisions or Implementation Blockers.
_Avoid_: Acceptance Reviewer, Specialist Reviewer, reviewer process

**Agent Environment**:
The optional command wrapper read from Repo Config that starts each host-run Implementer and reviewer with the repository's required development tools.
The same Agent Environment applies in the Managed Worktree and in a host-run Validation Workspace.
It does not alter Repository Preparation or Checks.
If the configured wrapper fails, But Why stops the agent operation without an unwrapped retry.
_Avoid_: Interactive Session Environment, Reviewer Environment, Caller-checkout config, Global Config preference, Repository Preparation, Herdr configuration

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
The coding agent that judges a Task-backed Change's Candidate or no-change repository state against immutable Acceptance Context.
_Avoid_: Specialist Reviewer, Implementer

**Specialist Reviewer**:
A configured coding agent that judges one named repository concern without receiving Acceptance Context.
_Avoid_: Built-in Acceptance Reviewer, Final Reviewer

**Validation Workspace**:
An isolated disposable workspace in which one Validation Run judges the exact Candidate without changing it.
_Avoid_: Task Worktree, Interactive Session

**Validation Tooling Failure**:
A failure in But Why or its validation tooling that prevents a trustworthy judgment of the Candidate.
_Avoid_: Finding, failed Check result

**Repository Preparation**:
The configured setup that establishes dependencies or tools in a new Managed Worktree or Validation Workspace.
_Avoid_: Validation-only setup, package-manager-specific install stage

**Repo Config**:
Tracked repository configuration for Prepare, Checks, local validation files, reviewer overrides, Specialists, and Repo Agent Profiles.
_Avoid_: Global user preference, detected Git fact

**Global Config**:
User-level local configuration for reusable Agent Profiles, reviewer defaults, and Interactive Session preferences.
_Avoid_: Repository policy, detected Git fact

**Agent Profile**:
A named reusable configuration of an agent runtime, including its model, thinking level, and runtime-specific execution resources.
An Agent Profile does not define an agent role's lifecycle or safety invariants.
_Avoid_: Reviewer instructions, agent role, validation phase
