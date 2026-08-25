# Task Operations

Use this procedure when authoring, revising, recording, or submitting a Task.
Let `<but-why>` represent the command prefix resolved by the But Why command guidance.

## Author and record Tasks

1. Gather the Operator-approved outcome, applicable authority, existing Tasks, and relevant repository evidence.
   Ask the Operator when the outcome or scope is unclear.
2. Before composing or revising a proposed Task, read [Task authoring](task-authoring.md) completely and apply it to the proposed Tasks and their actual Task Dependencies.
3. Present the proposed Task titles, intended outcomes, actual dependencies, and unresolved choices that affect scope or observable behavior.
4. Obtain Task Recording Authorization before mutating any Task or Task Dependency.
   This authorization permits clear description wording and dependency encoding within the agreed scope.
   It does not authorize Task Submission, Change Start, or implementation.
5. Record the agreed Tasks and only their actual prerequisites.
   For an approved unlinked Todo Task, run `<but-why> task revise <task-id>` before using a Task Context draft and apply operation.
   Revision returns the Task to New without changing its current Context or direct Task Dependencies.
   For an existing New Task, use the Task Context draft and apply operation directly.
6. Treat each successful mutation result as authoritative for its returned committed fields.
   Use an inspection command only when the result omits required recording state.
   Verify that every recorded Task remains unapproved and unlinked to a Change.

This section is complete when the authorized Tasks and Task Dependencies are recorded, unapproved, and unlinked to a Change.

## Submit a Task

Obtain Task Submission Authorization for the selected Task and intended outcome before running Task Submission.
Run `<but-why> task submit <task-id>` for the exact authorized New Task proposal.
Ordinary Task Submission selects the newest completed Review for an unchanged New Task proposal and reuses it only when it passed.
Finding-blocked and tooling-failed Reviews remain history and are not reusable judgments.
A later authorized submission of an unchanged New Task proposal runs a new Task Review.

Inspect the complete structured result, including its Task Review outcome and `simplificationAdvice`, regardless of whether the Review passed, reported Findings, or had a Tooling Failure.
Completed Task Simplification Advice is non-authoritative and independent of the Task Review judgment.
In the Operator response, state whether Task Submission returned completed advice with options, completed advice with no options, or unavailable advice.
When it contains options, summarize each option and its material trade-offs to the Operator.
When it contains no options, state that no safe simplification was proposed and include its reason when useful.
When `simplificationAdvice.state` is `unavailable`, report the relevant tooling evidence without treating that unavailability as a Task Review failure.
Do not apply an option automatically.
If the Operator selects an option, revise the proposed Task under Task Recording Authorization and obtain new Task Submission Authorization before submitting it again.
For an unlinked Todo Task whose Review passed, run `<but-why> task revise <task-id>` before recording the revised proposal.
When the Review has Findings, simplification advice may inform the revision but does not replace resolving every applicable Finding.

Use the returned Review state, outcome, and help to identify the valid next action.
If Task Submission reports an Active Task Review, inspect it with `<but-why> task-review show <review-id>`.
If its process has stopped and it cannot finish, use the reported exact abandonment command.
Run `<but-why> task reviews <task-id>` to inspect ordered Task Review history and valid next actions.
Run `<but-why> task-review show <review-id>` to inspect one Review's proposal, executed reviewer configuration when available, outcome, Findings or Tooling Failure, recovery state, Agent Session, Invocations, and Continuations.
A Review with no linked Invocation reports no executed reviewer configuration or Agent Session.
Resolve every applicable Finding by updating the New Task proposal before requesting another Review, or submit the unchanged New Task again when a new Task Submission is authorized.

Task Submission is the only supported route that can approve an unlinked New Task.
Task Submission does not authorize Change Start or implementation.

This section is complete when the result and any Task Simplification Advice have been reported, and either the selected Task is approved or its valid next action is explicit.
