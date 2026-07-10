# But Why?

But Why? validates completed code changes against approved human intent and coordinates the result through local state, branches, PRs, and optional external trackers.

## Language

**Validation Run**:
A validation attempt that judges one submitted commit SHA against Task Context through the Validation Gate, using the fixed comparison base SHA captured when the attempt starts.
In v1, a Task can have only one active Validation Run at a time.
A Validation Run can resume after a crash, but a new commit creates a successor Validation Run that may reuse prior results when policy allows.
A terminal Validation Run may be followed by another Validation Run for the same commit when validation must be retried.
_Avoid_: Run, job, pipeline run

**Validation Run History**:
The ordered set of Validation Runs for a Task across submissions and retries.
Validation Run History keeps prior Findings inspectable without changing the meaning of latest Findings.
_Avoid_: Run archive, finding history

**Trigger**:
An external signal that asks But Why? to start or continue validation.
A trigger is not the source of truth for validation state.
_Avoid_: Workflow state, lifecycle state

**Task**:
A But Why work unit that captures requested change intent.
A Task can have zero or more External References, and many Tasks can reference the same external tracker item.
In v1, each task owns one branch, and that branch belongs to only that task.
A task can have many Validation Runs as submissions are judged over time.
_Avoid_: Treating an external ticket, issue, or card as the Task identity.

**Task Slug**:
A deterministic, Git-safe and filesystem-safe operational name derived from a Task identity.
A Task Slug is for naming branches, refs, workspaces, and artifact paths, not for identifying the Task itself or labeling a Task in user-facing task UX.
_Avoid_: Treating a slug as the Task identity.

**Task Start**:
The explicit act of marking that implementation work has begun for a task.
A task start does not create the task, submit code for validation, or run implementation work.
_Avoid_: Submission, validation trigger, agent kickoff

**Task Lifecycle**:
The state model that describes where a Task is in the workflow and which state transitions are valid.
Same-state command no-ops are command behavior, not Task Lifecycle transitions.
Task Lifecycle is distinct from view-specific display policy such as dashboard actionability.
_Avoid_: Pipeline state, dashboard status

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

**Submission**:
A completed code candidate handed to But Why? for validation.
A Submission starts a Validation Run after an agent or human finishes implementing a task.
A Submission is not the Validation Run itself.
A failed preflight rejection is not a Submission because the candidate never entered validation.
_Avoid_: Push, handoff, delivery

**Submit Rejection Error**:
A failure that rejects a submitted candidate before But Why? creates a Submission or Validation Run.
A submit rejection error is not a finding and is not recorded on a Validation Run.
_Avoid_: Validation tooling failure, finding, Run error

**Submission Environment**:
The source of the submitted code candidate and the repo or runtime facts needed to validate it.
A Submission Environment can be local, CI-backed, or remote-backed without changing what a Submission means.
_Avoid_: Treating the current local checkout as the only possible submission environment.

**GitHub PR Target**:
The GitHub repository and base branch where But Why? will eventually publish the task's PR.
A GitHub PR target is usable only when But Why? can identify the repository, identify the base branch, and make an authenticated read request for that repository.
_Avoid_: Remote, upstream, origin

**Implementer**:
The agent or human responsible for making the requested code change.
The implementer owns product behavior and design changes, even when validation sends work back.
_Avoid_: Factory agent, coder

**Validation Gate**:
The stage that judges a submission against the task intent and project checks.
The validation gate is made of phases and rounds, and it must not trust the implementer’s own summary of intent.
_Avoid_: Pipeline, CI

**Acceptance Reviewer**:
A coding agent that determines the intended result from the Task Context Snapshot and judges whether the submission implements that result fully and correctly.
_Avoid_: Intent Reviewer, requirements tracer, task summarizer

**Validation Workspace**:
A resource scoped to exactly one Validation Run that provides an isolated copy of the submitted commit for validation phases to use.
A Validation Workspace exists until the Validation Run no longer needs that isolated copy.
A Validation Workspace is not itself a validation phase or round.
_Avoid_: Workspace phase, setup round, CI workspace

**Validation Tooling Failure**:
A failure in But Why? or its validation tooling that prevents validation from judging the submission.
A validation tooling failure is recorded on the Validation Run and is not a finding.
After a validation tooling failure, the task returns to its previous submit-eligible state.
_Avoid_: Finding, submission problem, needs input

**Reviewer Output Contract Failure**:
A Validation Tooling Failure where a reviewer never produces structured output that But Why? can safely interpret as a validation result.
_Avoid_: Parse error, exhausted retry, malformed finding

**Finding**:
A validation result that records a blocking problem or question about a submission, including failed configured checks.
In v1, any Finding sends the Task to needs input, and severity is optional impact judgment owned by producer contracts.
_Avoid_: Issue, error, comment, note

**Phase**:
A fixed part of the validation gate, such as prepare, checks, review, publishing, or PR watching.
Phases give findings and artifacts a stable place in validation history.
_Avoid_: Pipeline step, job

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
An append-only Markdown note attached to a task as Task Context.
Task comments do not change Task state.
In v1, Task Context exposes comments as ordered content, not public comment records.
_Avoid_: Finding, validation comment, note

**Task Context**:
The task title, task description, and task comment content used by reviewers to judge a submission.
Task context is the v1 source of intent.
Task context excludes Task metadata such as state, branch, Validation Runs, token totals, and comment count.
_Avoid_: Ticket data, prompt context

**Task Context Snapshot**:
The immutable Task Context owned by a Validation Run that records the intent judged by that run.
It contains the title, description, and ordered Task Comment content captured when validation starts.
_Avoid_: Task Context revision, live Task Context

**Repo Config**:
Repository-owned configuration that defines how But Why? validates work for that repository.
Repo Config owns validation policy such as validation commands, sandbox policy, and reviewer selection.
_Avoid_: Project defaults, local config

**Global Config**:
User-owned or machine-owned configuration for reusable local settings shared across repositories.
Global Config can define Agent Profiles, but it does not define a repository's validation policy.
_Avoid_: Repo fallback config, validation defaults

**Agent Profile**:
A named configuration for running an agent reviewer.
Agent profiles choose the agent runtime and model without making the reviewer role depend on one specific runtime.
_Avoid_: Provider config, model config
