# But Why?

But Why? validates completed code changes against approved human intent and coordinates the result through local state, branches, PRs, and optional external trackers.

## Language

**Run**:
A durable record of one But Why execution attempt for a Task.
A Run can store status, timing, artifacts, logs, token usage, and links to more specific execution records.
A Task can have many Runs.
_Avoid_: Treating Run as validation-specific when the rule belongs to Validation Run.

**Validation Run**:
A Run that validates one submitted commit SHA against Task Context through the Validation Gate.
In v1, a Task can have only one active Validation Run at a time.
A Validation Run can resume after a crash, but a new commit creates a successor Validation Run that may reuse prior results when policy allows.
A terminal Validation Run may be followed by another Validation Run for the same commit when validation must be retried.
_Avoid_: Job, pipeline run

**Trigger**:
An external signal that asks But Why? to start or continue validation.
A trigger is not the source of truth for validation state.
_Avoid_: Workflow state, lifecycle state

**Task**:
A But Why work unit that captures requested change intent.
A Task can have zero or more External References, and many Tasks can reference the same external tracker item.
In v1, each task owns one branch, and that branch belongs to only that task.
A task can have many runs as its branch changes over time.
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
The place responsible for the durable Task content and lifecycle state at a given time.
Local-only tasks can be authoritative inside But Why local state.
Remote-backed tasks can be authoritative in an external Task Surface while But Why stores local validation state.
_Avoid_: Assuming all Task data in local state is authoritative.

**Task Surface**:
A place where humans or agents view tasks, change task state, and read task comments.
A task surface can be built into But Why? or backed by an external board.
_Avoid_: Board, tracker, project management system when speaking about the But Why? domain

**Programmatic CLI Consumer**:
Software that invokes `by` as a subprocess and parses structured stdout as an API contract.
Programmatic CLI consumers are first-class v1 consumers alongside shell-based agents.
_Avoid_: Internal API, human CLI user

**Actionable Dashboard Item**:
A task that should appear in the default `by` dashboard because it has a clear next human or agent action.
In v1, actionable dashboard items are tasks in `todo`, `needs_input`, or `ready`.
_Avoid_: Treating every non-done task as dashboard-actionable

**Submission**:
A completed code candidate handed to But Why? for validation.
A submission is the normal trigger after an agent or human finishes implementing a task.
A failed preflight rejection is not a submission because the candidate never entered validation.
_Avoid_: Push, handoff, delivery

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

**Validation Workspace**:
Run-scoped setup that provides an isolated copy of the submitted commit before validation phases begin.
A validation workspace is not itself a validation phase or round.
_Avoid_: Workspace phase, setup round, CI workspace

**Validation Tooling Failure**:
A failure in But Why? or its validation tooling that prevents validation from judging the submission.
A validation tooling failure is recorded on the run and is not a finding.
After a validation tooling failure, the task returns to its previous submit-eligible state.
_Avoid_: Finding, submission problem, needs input

**Finding**:
A validation result that records a blocking problem or question about a submission.
In v1, any finding sends the task to needs input.
_Avoid_: Issue, error, comment, note

**Phase**:
A fixed part of the validation gate, such as checks, review, publishing, or PR watching.
Phases give findings and artifacts a stable place in the run history.
_Avoid_: Pipeline step, job

**Round**:
One recorded attempt inside a validation phase.
A round stores its result, findings, token usage, logs, artifacts, and the policy decision that ended it.
_Avoid_: Step run, attempt

**Producer**:
The command, reviewer, service, or tool that creates a finding, artifact, or token usage record inside a round.
Producers are shown as the human-readable source of validation output.
_Avoid_: Tool, actor, substep

**Task Comment**:
An append-only Markdown note attached to a task as Task Context.
Task comments do not change Task state.
In v1, Task Context exposes comments as ordered content, not public comment records.
_Avoid_: Finding, validation comment, note

**Task Context**:
The task title, task description, and task comment content used by reviewers to judge a submission.
Task context is the v1 source of intent.
Task context excludes Task metadata such as state, branch, runs, token totals, and comment count.
_Avoid_: Ticket data, prompt context

**Agent Profile**:
A named configuration for running an agent reviewer.
Agent profiles choose the agent runtime and model without making the reviewer role depend on one specific runtime.
_Avoid_: Provider config, model config
