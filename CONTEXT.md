# But Why? Domain Context

This glossary defines canonical language for the Change-centered v1 target.
`docs/architecture.md` documents the current implementation.
Detailed behavior belongs in approved specifications, accepted ADRs, and implementation Tasks.

**Change**:
The durable owner of one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and owned PR, optionally linked to one Task.
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
_Avoid_: Worktree path, remote branch, Candidate

**Change Base**:
The recorded comparison and publication target from which a Change's Candidates are judged.
_Avoid_: Current merge base chosen implicitly, starting worktree path

**Candidate**:
One immutable committed code state identified by an exact comparison base and head within a Change.
_Avoid_: Change, working tree, Submission, Validation Run

**Current Candidate**:
The latest Candidate selected from the Managed Worktree for the open Change.
_Avoid_: Latest historical Candidate, dirty workspace

**Acceptance Context**:
The immutable approved Task intent captured when the Task starts and supplied only to Acceptance Review.
_Avoid_: Current mutable Task text, Specialist instructions, inferred intent

**Validation Run**:
One durable execution and judgment of one Candidate under one resolved validation policy.
_Avoid_: Candidate, retry Attempt, generic job

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
_Avoid_: Mutable current config, raw config hash

**Task**:
The durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
_Avoid_: Change, issue draft, implementation session

**Task Slug**:
The canonical filesystem-safe operational name derived from a Task ID.
_Avoid_: Display title, raw Task ID in process names

**Task Approval**:
The permanent confirmation that a New Task's intent is approved for implementation.
_Avoid_: Change Start, reviewer approval

**Change Start**:
The operation that creates a Change, its Managed Worktree, and its starting commit.
It may link an approved Task and capture its Acceptance Context.
_Avoid_: Agent launch alone, validation, arbitrary state assignment

**Task Lifecycle**:
The user-facing progress of a Task through New, Todo, Implementing, Validating, Ready, Done, or Cancelled.
_Avoid_: Validation Run state, generic pipeline

**Task Dependency**:
A directed prerequisite relationship that blocks the dependent Task from starting until the prerequisite is Done.
_Avoid_: Queue priority, Git base relationship

**New Task**:
A Task whose intent has not been approved.
_Avoid_: Todo Task, draft Markdown issue

**Todo Task**:
An approved Task whose implementation has not started.
_Avoid_: New Task, Ready Task

**Done Task**:
A terminal Task completed by an observed merged owned PR or passing No-Change Submission.
_Avoid_: Ready Task, Cancelled Task

**Cancelled Task**:
A terminal Task whose work was ended without satisfying its dependencies.
_Avoid_: Done Task, deleted Task

**Shared Repository State**:
SQLite and other local operational state resolved through Git's common directory so every linked worktree sees the same facts.
_Avoid_: Copied state file, tracked Repo Config, per-worktree database

**Managed Worktree**:
The persistent But Why-owned Git branch and linked worktree belonging to one open Change.
_Avoid_: Validation Workspace, caller checkout, temporary agent worktree, Task Worktree

**Interactive Session**:
An optional visible external-agent process hosted in a Managed Worktree, with Herdr as the temporary v1 integration.
_Avoid_: Task state, Validation Run, background Supervisor worker

**Interactive Session Host**:
An external tool that opens and presents an Interactive Session in a supplied Managed Worktree.
_Avoid_: Git worktree manager, validation runner, generic agent provider

**Active Interactive Session**:
The one running Interactive Session associated with an open Change.
An open Change has at most one.
_Avoid_: Active Implementer, current Validation Run

**Submission**:
The act of asking But Why? to inspect a Change's Managed Worktree, select its Candidate or no-change state, validate it, and publish when eligible.
_Avoid_: Push, Candidate, Validation Run

**No-Change Submission**:
A Submission whose current tracked tree matches the Task's recorded starting tree and therefore runs Acceptance Review only.
_Avoid_: Empty commit, caller assertion, cancelled Task

**Submit Rejection Error**:
A failure that rejects Submission before a Candidate-owned Validation Run or no-change review begins.
_Avoid_: Finding, Validation Tooling Failure

**Submission Environment**:
The Managed Worktree and repository facts from which Submission reads the committed code and local validation environment.
_Avoid_: Validation Workspace, current caller checkout

**GitHub PR Target**:
The authenticated GitHub repository and base branch where But Why? may publish an exact passing Candidate.
_Avoid_: Git remote name, owned PR

**Implementer**:
The human or external interactive agent responsible for writing and committing Change work and addressing returned Findings.
_Avoid_: Acceptance Reviewer, Specialist Reviewer, But Why Fixer

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
A failure in But Why? or its validation tooling that prevents a trustworthy judgment of the Candidate.
_Avoid_: Finding, failed Check result

**Reviewer Revision Session**:
A two-request review of a new Candidate where the first request is blind and the second produces the final report after seeing earlier Findings.
_Avoid_: Finding reconciliation graph, continued old conversation

**Reviewer Output Contract Failure**:
A Validation Tooling Failure where reviewer output cannot be interpreted as a trustworthy Finding report.
_Avoid_: Finding, Candidate problem

**Finding**:
An immutable problem report produced by Prepare, a Check, Acceptance Review, or a Specialist for one Candidate or no-change review.
_Avoid_: Tooling Failure, Task Comment, mutable issue

**Phase**:
A named subdivision of the Validation Gate that gives validation work, Findings, and Artifacts stable context.
_Avoid_: Publication step, generic job

**Repository Preparation**:
The configured setup that establishes dependencies or tools in a new Managed Worktree or Validation Workspace.
_Avoid_: Validation-only setup, package-manager-specific install stage

**Prepare Phase**:
The optional first Validation Run phase that applies Repository Preparation for later validation phases.
_Avoid_: Check, implementation-worktree readiness

**Producer**:
The configured Check or Reviewer identity that produced validation evidence.
_Avoid_: Agent Profile, process ID

**Artifact**:
A durable reference to bounded validation evidence with explicit Run, phase, producer, storage, and truncation metadata.
_Avoid_: Untracked file, copied secret content, console-only output

**Task Comment**:
An ordered Markdown addition to Task Context before Task Start.
_Avoid_: Finding, cancellation reason, implementation decision

**Task Context**:
The current Task title, description, and ordered comments before Start.
_Avoid_: Acceptance Context, operational metadata

**Task Context Draft**:
A disposable editable copy of Task Context prepared before its proposed changes are applied.
_Avoid_: Task Worktree, durable Task Context, Artifact

**Task Context Snapshot**:
The immutable stored copy of Task Context captured as Acceptance Context at Start.
_Avoid_: Live Task text, prompt transcript

**Repo Config**:
Tracked repository configuration for Prepare, Checks, local validation files, reviewer overrides, Specialists, and Repo Agent Profiles.
_Avoid_: Global user preference, detected Git fact

**Global Config**:
User-level local configuration for reusable Agent Profiles, Acceptance overrides, Specialist defaults, and optional interactive-session preferences.
_Avoid_: Repository policy, project-tracked config

**Agent Profile**:
A named reusable selection of agent runtime, model, and thinking level.
_Avoid_: Reviewer instructions, validation phase

**Default Agent Profile**:
The Global Agent Profile used when a reviewer does not select another profile explicitly.
_Avoid_: Repo-local fallback with the same name
