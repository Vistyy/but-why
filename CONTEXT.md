# But Why?

But Why? validates completed code changes against approved human intent and coordinates the result through local state, branches, PRs, and optional external trackers.

## Language

**Run**:
A durable validation record for one commit SHA.
A task can have only one active run at a time.
A run can resume after a crash, but a new commit creates a successor run that may reuse prior results when policy allows.
A terminal run may be followed by another run for the same commit when validation must be retried.
_Avoid_: Job, pipeline run

**Trigger**:
An external signal that asks But Why? to start or continue validation.
A trigger is not the source of truth for validation state.
_Avoid_: Workflow state, lifecycle state

**Task**:
A requested change represented by either one local record or one external board item.
In v1, each task owns one branch, and that branch belongs to only that task.
A task can have many runs as its branch changes over time.
_Avoid_: Ticket, issue, card when speaking about the But Why? domain

**Task Start**:
The explicit act of marking that implementation work has begun for a task.
A task start does not create the task, submit code for validation, or run implementation work.
_Avoid_: Submission, validation trigger, agent kickoff

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
