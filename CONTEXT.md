# But Why?

But Why? validates completed code changes against approved human intent and coordinates the result through local state, branches, PRs, and optional external trackers.

## Language

**Change**:
The durable lineage root for one evolving code change, including its Candidates, validation evidence, decisions, blocking state, and optional PR.
A Change has a permanent opaque identity independent of its branch and optional Task.
A Change may be linked to a Task, but it does not require one, and a Repository Branch binds at most one Change.
_Avoid_: Task, branch, Validation Run

**Open Change**:
The current active Change for a Repository Branch, to which new Candidates and validation history are added.
An Open Change becomes terminal when its work is closed.
_Avoid_: Latest Candidate, open pull request, active Task

**Closed Change**:
A terminal Change whose work is no longer active because it completed or was cancelled.
It remains available as history, records why it closed, and cannot reopen or accept new Candidates.
_Avoid_: Deleted Change, open pull request

**Local Repository**:
One local Git repository instance, shared by its main worktree and linked worktrees and identified by its canonical Git common directory.
_Avoid_: GitHub repository, clone-independent repository identity, worktree

**Repository Branch**:
A local branch in a Local Repository, identified by its full ref such as `refs/heads/feature`.
Renaming a Repository Branch preserves its Open Change when the rename can be proven or is explicitly confirmed.
_Avoid_: Short branch name, remote branch, GitHub PR Target

**Candidate**:
One exact committed version of a Change with a permanent opaque record identity.
Its immutable code identity within that Change is its fixed comparison base SHA and head SHA.
Submitting the same comparison again reuses the existing Candidate when its recorded base provenance also matches.
A conflicting account of how the base was chosen is rejected rather than changing the Candidate's history.
A Candidate may contain many Git commits between those SHAs.
_Avoid_: Single commit, working tree, branch head

**Acceptance Context**:
The immutable approved requirements used by Acceptance Review.
A Task Context Snapshot supplies Acceptance Context for a Task-backed Change, while a Change without Acceptance Context skips Acceptance Review.
_Avoid_: Inferred intent, live Task Context, code summary

**Validation Run**:
A durable attempt that judges one Candidate through the Validation Gate under fixed context and policy snapshots.
A new Candidate creates a new Validation Run, while the Change carries completed Specialist Reviewer evidence forward.
A later Validation Run may judge the same Candidate when validation must be retried.
_Avoid_: Change, job, pipeline run

**Validation Run History**:
The ordered set of Validation Runs for a Change across Candidates and retries.
Validation Run History keeps prior Findings and completed Specialist Reviewer evidence inspectable.
_Avoid_: Run archive, Finding history

**Validated Baseline**:
The latest Candidate whose exact head SHA passed all configured checks, Final Review, and Acceptance Review when required, after every required Specialist Reviewer completed and no Findings remained open.
A Specialist Reviewer may have completed on an earlier Candidate in the same linear Change because later code is covered by Final Review instead of reopening that Specialist Reviewer.
_Avoid_: Every reviewer ran on the final SHA, PR readiness, copied validation result

**Validation Policy Snapshot**:
The immutable resolved validation policy used by one Validation Run, including checks, reviewers, reviewer instructions, agent settings, and sandbox policy.
A canonical fingerprint allows later Validation Runs to prove that their resolved policy matches the Validated Baseline while the snapshot remains inspectable.
_Avoid_: Raw config file hash, reviewer name list, mutable current config

**Trigger**:
An external signal that asks But Why? to start or continue validation.
A trigger is not the source of truth for validation state.
_Avoid_: Workflow state, lifecycle state

**Task**:
A But Why work unit that captures requested change intent, comments, approval, tags, and user-facing progress.
A Task may have at most one Change and can have zero or more External References without owning validation state directly.
_Avoid_: Change, external ticket identity, workflow command bus

**Task Slug**:
A deterministic, Git-safe and filesystem-safe operational name derived from a Task identity.
A Task Slug is for naming branches, refs, workspaces, and artifact paths, not for identifying the Task itself or labeling a Task in user-facing task UX.
_Avoid_: Treating a slug as the Task identity.

**Task Approval**:
The explicit act of confirming that a New Task is ready for autonomous implementation.
Task Approval moves the Task to todo, which makes it eligible for an implementation claim.
_Avoid_: Task Start, implementation claim, PR readiness

**Task Start**:
The explicit act of claiming an approved Todo Task for manual implementation.
Task Start creates or reuses the Task's active Change and writable workspace and adopts the current Task Context as Acceptance Context.
_Avoid_: Task Approval, Task Resume, automatic implementation claim, Submission

**Task Resume**:
The explicit act of clearing an addressed Needs Input condition and continuing the same active Change from its durable facts.
Task Resume adopts the latest Task title, description, and ordered comments as Acceptance Context and emits a Trigger without choosing a run type itself.
_Avoid_: Task Start, Task Approval, adding a comment without resuming

**Task Lifecycle**:
The user-facing state model derived from Task approval and the active Change's progress, blockers, and PR facts.
Task Lifecycle describes progress without authorizing Change or Validation Gate phases.
_Avoid_: Pipeline state, workflow command bus, duplicate Change state

**Task Dependency**:
A directed prerequisite relationship in which one Task must be done before another Task can start.
Task Dependencies govern both manual starts and automatic pickup.
_Avoid_: Issue implementation order, scheduling priority, Change dependency

**New Task**:
A Task whose intent is still being created or refined under human supervision.
A New Task is not eligible for autonomous implementation.
_Avoid_: Draft Task, todo Task, implementation-ready Task

**Todo Task**:
A Task whose intent has been approved for implementation.
A Todo Task is available for manual implementation and becomes eligible for automatic pickup when it has the AFK tag.
_Avoid_: New Task, ready Task, treating every created Task as approved

**Cancelled Task**:
A terminal Task whose work will not continue or reopen.
Cancelling a Task also closes its Open Change as cancelled while preserving their history.
_Avoid_: Done Task, deleted Task, abandoned Task

**Task Tag**:
A validated label attached to a Task from the set of tags known to But Why?.
Unknown tag names are rejected instead of being stored as new labels accidentally.
_Avoid_: Unvalidated free-form label, Task state

**AFK Task**:
A Todo Task with the built-in `afk` tag that allows the background worker to pick it up automatically.
The AFK tag controls automatic pickup without changing Task Lifecycle state.
_Avoid_: Treating every Todo Task as automatic, separate automatic Task state

**External Reference**:
A link from a Task to another system's work item, such as a Jira issue, GitHub issue, Linear issue, or board card.
An External Reference provides context or traceability, but it does not define the Task's identity.
_Avoid_: Using the external issue key as the But Why Task unless the Task Surface explicitly defines that mapping.

**Task Authority**:
The source that owns durable Task content and lifecycle state at a given time.
But Why asks the Task Authority for authoritative task decisions instead of depending on where the task data is stored.
_Avoid_: Assuming all Task data in local state is authoritative.

**Task Surface**:
A place where humans or agents view tasks, change task state, and read task comments.
A task surface can be built into But Why? or backed by an external board.
_Avoid_: Board, tracker, project management system when speaking about the But Why? domain

**Programmatic CLI Consumer**:
Software that invokes `by` as a subprocess and parses structured stdout as an API contract.
Programmatic CLI consumers are first-class v1 consumers alongside shell-based agents.
_Avoid_: Internal API, human CLI user

**Installed CLI**:
The `by` executable as used from outside the But Why? source checkout after package installation.
Installed CLI behavior is the user and agent contract for other repositories.
_Avoid_: Repo-local development command, source checkout wrapper

**Agent-Assisted Setup Guide**:
A public setup document that a user can hand to an agent or follow manually to install But Why?, initialize a repository, and choose whether and where to place the But Why agent skill.
The guide is not a hidden installer and does not silently change agent behavior.
_Avoid_: Interactive installer, bootstrap skill, silent skill install

**Repo-local CLI**:
The `by` command path used by But Why? contributors to run the current source checkout.
Repo-local CLI usage is for developing But Why? itself, not for using But Why? from another repository.
_Avoid_: Installed CLI, published CLI

**Actionable Dashboard Item**:
A task that should appear in the default `by` dashboard because it has a clear next human or agent action.
In v1, actionable dashboard items are tasks in `todo`, `needs_input`, or `ready`.
_Avoid_: Treating every non-done task as dashboard-actionable

**Needs Input**:
A Change-level pause used when no authorized automated path can continue because of a policy stop, impossible approved requirements, an external blocker, or exhausted safety or recovery limits.
The blocking Finding or failure remains the source of the required action.
_Avoid_: Normal agent uncertainty, routine implementation decision, duplicate reason field

**Needs Input Task**:
A Task whose active Change records Needs Input.
The Task displays the condition without becoming its source of truth.
_Avoid_: Task-owned blocker, separate Task failure state

**Submission**:
The act of capturing a committed Change head as a Candidate and requesting validation.
A Submission may come from Task-backed or standalone work and is distinct from the Validation Run it starts.
_Avoid_: Push, publication, Validation Run

**Submit Rejection Error**:
A failure that rejects a submitted candidate before But Why? creates a Submission or Validation Run.
A submit rejection error is not a finding and is not recorded on a Validation Run.
_Avoid_: Validation tooling failure, finding, Run error

**Submission Environment**:
The source of the submitted code candidate and the repo or runtime facts needed to validate it.
A Submission Environment can be local, CI-backed, or remote-backed without changing what a Submission means.
_Avoid_: Treating the current local checkout as the only possible submission environment.

**GitHub PR Target**:
The GitHub repository and base branch where But Why? may publish a Change.
A GitHub PR Target is usable only when But Why? can identify the repository and base branch and make an authenticated read request.
_Avoid_: Remote, upstream, origin

**Implementer**:
The agent or human responsible for producing and continuing the initial implementation of a Task-backed Change before validation.
The Implementer does not fix Validation Findings.
_Avoid_: Fixer Agent, reviewer, mode-specific fixer

**Fixer Agent**:
A coding agent invoked after Validation Findings to fix the Change Workspace, record decisions, and commit a successor Candidate.
The Fixer Agent is separate from the Implementer and remains outside the read-only Validation Gate.
_Avoid_: Repairer, Auto-fixer, Implementer continuation, reviewer

**Automatic Fixing**:
The policy-controlled use of a Fixer Agent without waiting for human action after Validation Findings.
Automatic Fixing is enabled by default and may be changed by Repo Config or a CLI override.
_Avoid_: Automatic Repair, Implementer continuation, reviewer fix, implicit validation

**Implementation Decision**:
A durable Change-scoped record of a choice made during implementation or revision because the approved context and repository guidance did not determine it.
Agents prefer recording uncertain cases over hiding them, while later views may filter the records for PR writing or analysis.
_Avoid_: Invisible choice, Task Comment, Attempt Summary, ADR

**Improvement Synthesis**:
A separate future capability that may analyze Implementation Decisions across Changes to find repeated gaps in planning or repository guidance.
Improvement Synthesis remains outside implementation and validation.
_Avoid_: Implementation phase, validation phase, Task summary

**Change Workspace**:
The writable workspace associated with a Change for implementation or fixing.
A standalone command uses its current clean checkout, while Task-backed background work uses a managed Sandcastle worktree.
_Avoid_: Validation Workspace, sandbox, Task identity

**Code-Writing Execution**:
The shared durable record for one invocation of an Implementer or Fixer Agent on a Change.
It records its role, expected head, status, result, Artifacts, failures, and Implementation Decisions.
_Avoid_: Agent process, Validation Run, workflow phase

**Implementer Execution**:
A Code-Writing Execution that works toward the initial Candidate from Acceptance Context.
_Avoid_: Fixer Execution, Validation Run

**Fixer Execution**:
A Code-Writing Execution that addresses assigned Findings for an exact Candidate.
_Avoid_: Implementer Execution, Validation Run

**PR Writer**:
The agent that writes a PR description from final code, validation evidence, recorded decisions, and optional Acceptance Context during publication.
The PR Writer does not implement, fix, or validate the Change.
_Avoid_: Implementer, reviewer, chained attempt summarizer

**Validation Gate**:
The read-only stage that judges a Candidate through configured checks and reviewers, using Acceptance Context when available.
The Validation Gate is made of phases and rounds, and it never modifies code.
_Avoid_: Repair loop, publishing workflow, CI

**Acceptance Reviewer**:
A coding agent that judges the current Candidate against immutable Acceptance Context.
Acceptance Review runs only when Acceptance Context exists.
_Avoid_: Using Intent Reviewer as a synonym for Acceptance Reviewer, requirements tracer, task summarizer

**Specialist Reviewer**:
A coding agent responsible for reviewing a Candidate for one configured concern.
It repeats after fixes to its own Findings until it produces none, then remains complete for later linear Candidates in the same Change while its concern, comparison base, and validation policy remain unchanged.
_Avoid_: Quality Reviewer, general reviewer

**Final Reviewer**:
A coding agent that reviews the current code after checks pass and every Specialist Reviewer is complete.
It may repeat after revisions to its own Findings, but it does not reopen or coordinate Specialist Reviewers.
_Avoid_: Specialist Reviewer, validation coordinator, PR Writer

**Validation Workspace**:
A read-only resource scoped to one Validation Run that provides an isolated copy of the exact Candidate head.
A Validation Workspace exists until the Validation Run no longer needs it and is not itself a Phase or Round.
_Avoid_: Change Workspace, workspace phase, CI workspace

**Validation Tooling Failure**:
A failure in But Why? or its validation tooling that prevents a Validation Run from judging the Candidate.
It is recorded on the Validation Run rather than as a Finding, and exhausted automatic recovery may cause Needs Input.
_Avoid_: Finding, Candidate problem, failed review

**Reviewer Output Contract Failure**:
A Validation Tooling Failure where a reviewer never produces structured output that But Why? can safely interpret as a validation result.
_Avoid_: Parse error, exhausted retry, malformed finding

**Finding**:
An immutable concrete validation problem reported by a configured check or reviewer against a Candidate.
A later fix and clean result resolve the Finding through a durable link without changing the original record.
_Avoid_: Ordinary uncertainty, Task Comment, implementation decision, note

**Phase**:
A fixed part of the Validation Gate, such as prepare, checks, Specialist Review, Final Review, or Acceptance Review.
Phases give Findings and Artifacts a stable place in validation history.
_Avoid_: Pipeline step, publishing step, job

**Prepare Phase**:
A fixed validation gate phase that prepares the Validation Workspace for validation phases that need repo tooling.
Prepare Phase failures are validation findings when the submitted workspace cannot be prepared for validation.
_Avoid_: Setup step, pre-check hook, install step, prepare checks

**Round**:
One recorded attempt inside a validation phase.
A round stores its result, findings, token usage, logs, artifacts, and the policy decision that ended it.
_Avoid_: Step run, attempt

**Producer**:
The command, reviewer, service, or tool that creates a finding, artifact, or token usage record inside a round.
Producers are shown as the human-readable source of validation output.
_Avoid_: Tool, actor, substep

**Token Usage Record**:
A validation accounting record that attributes agent token consumption to one Producer, agent runtime, and agent model.
Token Usage Records preserve input, cached input, output, and total token buckets separately and are not dollar costs.
_Avoid_: Cost record, usage blob, token total

**Artifact**:
A durable validation output record, such as command stdout, stderr, exit code, logs, reviewer output, or transcript, addressed by an artifact ref.
Artifact storage is outside the Validation Workspace.
_Avoid_: Workspace file, temp file, attachment

**Task Comment**:
An append-only Markdown note attached to a Task as Task Context.
A Task Comment does not change Task state or active Acceptance Context until Task Start or Task Resume adopts it.
_Avoid_: Finding, validation comment, implementation decision

**Task Context**:
The current Task title, description, and ordered Task Comment content.
Task Context excludes lifecycle state, Changes, Validation Runs, token totals, and other operational metadata.
_Avoid_: Acceptance Context, ticket data, prompt context

**Task Context Snapshot**:
An immutable approved Task Context revision used as Acceptance Context by a Task-backed Change.
It contains the title, description, and ordered Task Comment content adopted when the Task starts or resumes.
_Avoid_: Live Task Context, inferred intent, mutable comment feed

**Repo Config**:
Repository-owned configuration that defines how But Why? validates work for that repository.
Repo Config owns validation policy such as validation commands, sandbox policy, and reviewer selection.
_Avoid_: Project defaults, local config

**Global Config**:
User-owned or machine-owned configuration for reusable local settings shared across repositories.
Global Config can define Agent Profiles, but it does not define a repository's validation policy.
_Avoid_: Repo fallback config, validation defaults

**Agent Profile**:
A named configuration for running an agent in a specific runtime, with optional model and thinking settings.
Agent Profiles let execution roles choose a complete agent configuration without depending on one runtime.
_Avoid_: Provider config, model config, reviewer profile

**Default Agent Profile**:
The Agent Profile selected by Global Config for an agent execution role that does not select another profile.
_Avoid_: Default runtime, profile named `default`
