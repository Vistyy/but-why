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

**Proven Branch Rename**:
A Repository Branch rename shown by an exact Git rename record in the same Local Repository.
Only a Proven Branch Rename automatically preserves the Open Change under the new branch name.
_Avoid_: Matching commit, matching history, guessed rename

**Change Base**:
The target branch chosen for a Change when its first Candidate is captured.
It remains fixed unless the Change's PR is deliberately retargeted.
_Avoid_: Candidate comparison base, current default branch

**Rebind**:
The explicit act of moving an Open Change's Repository Branch binding to a branch with no Change history.
_Avoid_: Rename guess, creating a Change, reopening a Change

**Candidate**:
One exact committed version of a Change with a permanent opaque record identity.
Its immutable code identity within that Change is its fixed comparison base SHA and head SHA.
Submitting the same comparison again reuses the existing Candidate when its recorded base provenance also matches.
A conflicting account of how the base was chosen is rejected rather than changing the Candidate's history.
A Candidate may contain many Git commits between those SHAs.
_Avoid_: Single commit, working tree, branch head

**Current Candidate**:
The latest Candidate captured for an Open Change and the only Candidate whose validation may advance the Change's current state.
Earlier Candidates and their validation evidence remain available as history.
_Avoid_: Branch head, Validated Baseline, deleted Candidate

**Acceptance Context**:
The immutable approved requirements used by Acceptance Review.
A Task Context Snapshot supplies Acceptance Context for a Task-backed Change, while a Change without Acceptance Context skips Acceptance Review.
_Avoid_: Inferred intent, live Task Context, code summary

**Immutable Validation Inputs**:
The fixed Candidate, validation policy, Acceptance Context, and identified external inputs under which a Validation Run judges a Change.
_Avoid_: Live checkout files, mutable current config, unidentified external inputs

**Validation Run**:
The durable judgment of one Candidate under one exact set of Immutable Validation Inputs.
A Validation Run may contain multiple Execution Attempts but reaches one final outcome.
_Avoid_: Execution Attempt, Change, job, pipeline run

**Execution Attempt**:
One bounded effort to advance an unfinished Validation Run through the Validation Gate.
Attempt failures and retries do not themselves determine the Validation Run outcome.
_Avoid_: Validation Run, validation verdict, retry policy, Round

**Current Validation Run**:
The Validation Run that currently governs validation of an Open Change.
It is identified by the Current Candidate and Immutable Validation Inputs.
_Avoid_: Latest historical run, Validation Run History, parallel active run

**Validation Run State**:
The lifecycle position of a Validation Run: `active`, `complete`, `superseded`, or `cancelled`.
A complete run has a Validation Run Outcome, a superseded run was replaced by newer validation, and a cancelled run ended because its Change was cancelled.
_Avoid_: Task state, Change state, validation result

**Validation Run Outcome**:
The result of a complete Validation Run: `passed` or `blocked`.
A blocked outcome has Findings, while a tooling failure belongs to an Execution Attempt and does not complete the run.
_Avoid_: Validation Run State, Needs Input, phase status, tooling failure

**Superseded Validation Run**:
A Validation Run that stopped being current because newer code or validation inputs replaced it.
Its history remains inspectable but cannot advance the Change.
_Avoid_: Completed Validation Run, cancelled Candidate, deleted run

**Execution Attempt Lease**:
A temporary exclusive authority to advance one Execution Attempt.
_Avoid_: Validation Run ownership, permanent lock, Task claim

**Validation Run History**:
The ordered set of Validation Runs for a Change across Candidates and changed Immutable Validation Inputs.
Validation Run History keeps prior Findings and completed Specialist Reviewer evidence inspectable.
_Avoid_: Run archive, Finding history, Execution Attempt history

**Validated Baseline**:
The latest Candidate whose exact head SHA passed all configured checks, Final Review, and Acceptance Review when required, after every required Specialist Reviewer completed and no Findings remained open.
A Specialist Reviewer may have completed on an earlier Candidate in the same linear Change because later code is covered by Final Review instead of reopening that Specialist Reviewer.
_Avoid_: Every reviewer ran on the final SHA, PR readiness, copied validation result

**Validation Policy Snapshot**:
The immutable identity and resolved contents of the validation policy used by one Validation Run.
It distinguishes evidence produced under materially different validation semantics.
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
The permanent confirmation that a New Task is ready to become eligible for implementation.
_Avoid_: Task Start, implementation claim, PR readiness, reversible review state

**Task Start**:
The explicit act of claiming an approved Todo Task for manual implementation.
Task Start creates or reuses the Task's active Change and writable workspace and adopts the current Task Context as Acceptance Context.
_Avoid_: Task Approval, Task Resume, automatic implementation claim, Submission

**Task Hold**:
The explicit temporary suspension of progress on a nonterminal Task for a recorded operational reason.
_Avoid_: Needs Input, cancellation, paused process, generic state assignment

**Task Resume**:
The explicit continuation of a Held Task or a Task whose Needs Input condition has been addressed.
_Avoid_: Task Start, Task Approval, process continuation, blind retry

**Task Lifecycle**:
The user-facing progress of a Task as derived from its approval and linked Change facts.
Task Lifecycle does not own validation state.
_Avoid_: Pipeline state, generic state setter, duplicate Change state

**Task Dependency**:
A directed prerequisite relationship that governs whether a dependent Task is eligible to start.
_Avoid_: Issue implementation order, scheduling priority, Change dependency

**Task Queue Order**:
The explicit user-controlled relative order of nonterminal Tasks.
_Avoid_: Hidden priority, creation order, worker-local queue

**New Task**:
A Task whose intent has not been approved.
_Avoid_: Todo Task, implementation-ready Task, unapproval target

**Todo Task**:
An approved Task whose implementation has not started.
_Avoid_: New Task, Ready Task, treating every created Task as approved

**Held Task**:
A nonterminal Task whose progress has been temporarily suspended through Task Hold.
It preserves the reason and interrupted progress needed for later continuation.
_Avoid_: Needs Input Task, Cancelled Task, process suspended in memory

**Done Task**:
A terminal Task whose approved work has been completed.
It satisfies Task Dependencies and remains available as read-only history.
_Avoid_: Ready Task, Cancelled Task, manually assigned status

**Cancelled Task**:
A terminal Task whose work will not continue.
It preserves its Task and Change history without satisfying Task Dependencies.
_Avoid_: Done Task, deleted Task, no-change completion

**Task Tag**:
A validated label from the set of tags that But Why? defines for Task behavior.
_Avoid_: Unvalidated free-form label, Task state, completion mode

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
A Task shown in the default dashboard because it currently has a meaningful user action.
_Avoid_: Treating every unfinished Task as dashboard-actionable

**Needs Input**:
An orchestration-owned Change-level circuit breaker used when no approved automatic path can safely continue.
Only But Why? code records Needs Input from workflow facts; agents do not request it or control lifecycle state.
_Avoid_: Agent question, agent dispute, rejected command, pending automatic work, normal agent uncertainty, routine implementation decision

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
A coding agent that revises a Change in response to Validation Findings.
It produces code and decisions but does not own validation or lifecycle state.
_Avoid_: Repairer, Auto-fixer, Implementer continuation, reviewer, lifecycle coordinator

**Fixer Policy**:
The resolved orchestration policy governing whether and how Fixer Agents may run automatically.
Validation fixing and PR-readiness fixing are separate authorities.
_Avoid_: Automatic Repair, Implementer continuation, reviewer fix, implicit validation

**PR Readiness Fixer**:
A Fixer Agent authorized to address configured readiness failures on an owned PR.
It does not interpret human-authored GitHub content as implementation intent or own publication and merge authority.
_Avoid_: Review-comment responder, PR author, GitHub bot command handler, merger

**Sensitive Change**:
A PR-readiness revision that could alter controls or gain authority beyond that granted to the Fixer.
Its classification and permitted continuation are owned by orchestration policy rather than agent judgment.
_Avoid_: Agent safety judgment, every code change, prompt filtering result, automatic rejection

**Implementation Decision**:
A durable Change-scoped record of a consequential choice not determined by approved context or repository guidance.
It explains implementation judgment without changing Task or Change lifecycle state.
_Avoid_: Invisible choice, agent question, lifecycle transition, Task Comment, Attempt Summary, ADR

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

**Code-Writing Budget Cycle**:
A bounded authorization period for automatic Implementer and Fixer Executions on one Change.
_Avoid_: Token budget, operational retry limit, erased usage history

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
A coding agent that judges a Candidate against immutable Acceptance Context when that context exists.
_Avoid_: Intent Reviewer, requirements tracer, Task summarizer

**Specialist Reviewer**:
A configured coding agent that judges a Candidate for one explicit repository concern.
Its concern is distinct from Acceptance Review and Final Review.
_Avoid_: Quality Reviewer, general reviewer

**Final Reviewer**:
The general coding agent responsible for the concluding review of a Candidate.
It does not replace or coordinate configured Specialist Reviewers.
_Avoid_: Specialist Reviewer, validation coordinator, PR Writer

**Parallel Reviewer Group**:
A set of required read-only reviewers evaluating the same Candidate concurrently within one validation phase.
_Avoid_: Sequential checks, code-writing batch, all-or-nothing Attempt output

**Validation Workspace**:
An isolated disposable workspace in which one Execution Attempt judges the exact Candidate without changing it.
_Avoid_: Change Workspace, workspace phase, CI workspace

**Validation Tooling Failure**:
A failure in But Why? or its validation tooling that prevents an Execution Attempt from advancing toward a judgment.
It belongs to execution rather than describing a problem in the Candidate.
_Avoid_: Finding, Candidate problem, failed review

**Reviewer Revision Session**:
A reviewer interaction that evaluates a successor Candidate in relation to that reviewer's prior Findings.
It produces authoritative current Findings without mutating historical Findings.
_Avoid_: Continuing the original reviewer session, mutating old Findings

**Reviewer Output Contract Failure**:
A Validation Tooling Failure in which reviewer output cannot be interpreted as a trustworthy validation result.
_Avoid_: Finding, Candidate failure, malformed output treated as a verdict

**Finding**:
An immutable concrete validation problem reported by a configured check or reviewer against a Candidate.
A later fix and clean result resolve the Finding through a durable link without changing the original record.
_Avoid_: Ordinary uncertainty, Task Comment, implementation decision, note

**Phase**:
A named subdivision of the Validation Gate that gives validation work, Findings, and Artifacts a stable domain context.
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
A durable validation output record, such as command stdout, stderr, exit code, logs, reviewer output, or transcript, with a permanent opaque identity.
Its metadata records the producing Validation Run, Execution Attempt, Phase, Round, Producer, and filename while its storage remains outside the Validation Workspace.
_Avoid_: Workspace file, temp file, attachment, provenance encoded into an ID

**Task Comment**:
An append-only Markdown instruction that contributes to Task Context.
_Avoid_: Hold reason, external-resolution reason, Finding, Implementation Decision

**Task Context**:
The current Task title, description, and ordered Task Comment content.
It owns requested intent rather than operational or validation state.
_Avoid_: Acceptance Context, Hold reason, ticket data, operational metadata

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
