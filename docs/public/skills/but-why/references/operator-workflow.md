# Operator Workflow

Use this reference when selecting a Work Route, recording Tasks, submitting a Task for review, authorizing implementation, or starting a fresh Implementer Interactive Session.
Read target-repository instructions and current repository state before you act.
Use a repository documentation authority map when one exists.
Do not infer documentation authority from a file name, directory, or document label.
Treat historical material only as evidence unless the Operator approves it as a current requirement source.

## Authority

**Work Route Selection** is the Operator's explicit choice of a Task-backed Change, a taskless Change, or a direct edit outside But Why.
You may recommend a Work Route, but you must follow the Operator's selected Work Route.
If the selected Work Route conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent, report the conflict and request direction through the applicable authority mechanism.

**Task Recording Authorization** is the Operator's explicit permission to record one complete proposed Task graph.
It permits only the approved Task Context and Task Dependency mutations.
It does not permit Task Submission, Change Start, implementation, or Implementation Authorization.

**Task Submission Authorization** is the Operator's explicit permission to submit one exact presented Task Context and direct Task Dependency set for advisory Task Review.
It covers only that exact proposal and does not permit a changed proposal, Task Recording, Task Approval, Change Start, implementation, or Implementation Authorization.

**Task Approval** is the Operator's explicit confirmation that one recorded Task can move from New to Todo.
A Task Review is advisory and does not grant Task Approval.
Task Approval does not start a Change or launch implementation.

**Implementation Authorization** is the Operator's explicit permission to implement one selected work item through its selected Work Route.
Task Recording Authorization, Task Submission Authorization, and Task Approval do not grant Implementation Authorization.
Do not begin implementation or start a Change without Implementation Authorization for that work item.
A Task-backed Change Implementation Authorization requires starting or verifying a fresh Implementer Interactive Session.
A taskless Change uses the current session unless Implementation Authorization explicitly requests a fresh Implementer Interactive Session.

## Select a Work Route

1. Read the requested outcome, applicable authority, target-repository instructions, and current Task ownership.
   Identify consequential assumptions or trade-offs that could change Task boundaries, observable behavior, or implementation.
2. Resolve each consequential uncertainty before you split Tasks or implement affected work.
   Ask the Operator for a decision when available evidence cannot resolve it.
3. Recommend a suitable Work Route from the required intent and validation authority.
   Use a Task-backed Change for durable approved intent, a taskless Change for a validated code change without Task intent, or a direct edit when But Why is not required.
   After the Operator selects a Task-backed Change, Work Route Selection does not determine Task count or size.
4. Obtain the Operator's explicit Work Route Selection.
   Do not substitute another Work Route after the Operator selects one.

This section is complete when the Operator's selected Work Route and its selected work item are explicit.

## Author Tasks

Before designing or revising a Task Verification Contract, read [Task verification](task-verification.md) completely.

1. Gather the Operator-approved requirements and applicable current authority.
   Do not infer approval from brainstorming or provisional planning.
   Ask the Operator when requirement approval is unclear.
   Inspect current Tasks, their complete Task Context, and their dependencies.
   Identify one current Task owner or one ownership gap for every requirement.
2. Propose the complete Task graph before mutation.
   Account for every approved requirement exactly once across the graph and assign each approved behavior and constraint to one Task.
   Do not omit, replace, defer, or reduce approved behavior to make a Task smaller.
   Treat any such proposal as a requirements change that requires an explicit Operator decision.
   Each proposed Task must deliver one bounded supported result: a completed state that is distinguishable from the prior supported state, is independently acceptable progress toward approved intent, and can be implemented, reviewed, and verified coherently.
   Before recording each Task, state its supported completion result in one sentence.
   Identify any included behavior that can be delivered later while leaving that result safe, usable, and independently acceptable.
   Assign that behavior to another Task with its own bounded supported result.
   A quality, theme, final objective, shared owner, implementation area, or preferred sequence is not by itself a Task result.
   Split approved intent when it contains multiple bounded supported results.
   Do not merge results to minimize Task count or because they contribute to one final objective.
   Do not split solely by files, modules, layers, commands, test categories, or implementation effort.
   Treat implementation, review, or verification difficulty as evidence that the proposed boundary must be reconsidered.
   If no practical bounded result is clear, present the evidence and obtain an Operator decision before recording the Task.
   A migration stage or caller population can be a Task when it ends in an approved coherent supported state with a bounded passing condition.
   A preparatory activity is a Task only when its output is itself an approved bounded supported result.
   Add a Task Dependency only when the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
3. Give each proposed Task behavior-based acceptance criteria and a complete Task Verification Contract.
   Keep acceptance criteria separate from verification mechanisms.
   Do not use generic gates, test counts, coverage targets, or unsupported test categories as acceptance criteria.
   Follow the Task verification reference to define proportionate implementation confidence.
   Include a `## Review path` section in every proposed Task Context.
   State a concise path by which one human can understand and judge the complete implementation and required evidence as one coherent Change.
   Use available repository evidence, including evidence from prior implementation attempts, to decide whether the path is practical.
   Files, modules, layers, verification areas, and expected effort can inform this judgment, but none determines it alone.
   Do not turn the review path into a detailed implementation plan, an exact file forecast, a line estimate, or an effort estimate.
4. Before requesting Task Recording Authorization, review the exact final Task Contexts and dependencies against current authority, ownership, verification feasibility, and cross-Task overlap.
   Confirm that each review path covers its complete supported result and remains practical in light of the available evidence.
   If no practical review path can be stated, present the evidence and concern instead of requesting Task Recording Authorization.
   Task lifecycle state does not establish implementation readiness.
5. Present the complete Task graph, exact Task Contexts including each `## Review path` section, Task Dependency rationale, and recording order.
   Obtain Task Recording Authorization before any Task or Task Dependency mutation.
6. Record only the authorized Task Context and Task Dependencies.
   Use CLI help for the exact syntax before each command.
   Create Tasks in the authorized recording order and set each complete dependency set.
   Use a Task Context draft and apply operation for an existing unstarted Task.
7. Treat each successful mutation result as authoritative for its returned committed fields.
   Run Task Show, Task Context, or dependency inspection only when required recording state is omitted from that result.
   Verify every recorded Task remains unapproved and has no Change through the returned state or the applicable inspection command.

This section is complete when every authorized Task and Task Dependency is recorded, unapproved, and unlinked to a Change.

## Submit a Task for Review

When the Operator explicitly requests Task Submission Authorization, inspect the selected recorded Task and its complete Task Context and direct Task Dependency set.
Present the exact Context and dependency set to the Operator and obtain Task Submission Authorization for that exact proposal before running `by task submit <task-id>`.
Do not submit a different proposal, and do not record Task Context or dependency changes without a new Task Recording Authorization.
Treat the returned Task Review result as authoritative.
Passed, Finding-blocked, and tooling-failed Reviews leave the Task New.
After a passed Review, obtain separate Task Approval before running `by task approve <task-id>`.
After Findings, revise the Task only with new Task Recording Authorization.
After Tooling Failure, use the returned recovery action.
Run `by task show <task-id>` only when required review or Change-link state is omitted.
Do not approve the Task, start a Change, or launch an Implementer Interactive Session as part of Task Submission.

This section is complete when the selected Task proposal has Task Submission Authorization and its returned advisory Task Review result is known.

## Approve a Task

When the Operator explicitly requests Task Approval, inspect the selected recorded Task and run `by task approve <task-id>`.
Treat the returned Task state as authoritative, and run `by task show <task-id>` only when required approval or Change-link state is omitted.
Do not start a Change or launch an Implementer Interactive Session as part of Task Approval.

This section is complete when the selected Task is approved and no Change has started from this action.

## Authorize Implementation

When the Operator gives Implementation Authorization, confirm the selected work item and selected Work Route.
For a Task-backed Change, require starting or verifying a fresh Implementer Interactive Session.
For a taskless Change, confirm whether the authorization explicitly requests a fresh Implementer Interactive Session.
Do not infer permission to start a fresh taskless Implementer Interactive Session from authorization to implement.

For a direct edit, implement only the authorized work in the current repository according to target-repository instructions.
A direct edit does not start a Change, run But Why validation, publish a pull request, or launch an Interactive Session.

For a Task-backed Change, confirm that the selected Task is approved and start or verify a fresh Implementer Interactive Session.
For a taskless Change, confirm that the selected work remains taskless and implement it in the current session unless Implementation Authorization explicitly requests a fresh Implementer Interactive Session.

This section is complete when the authorization identifies one work item and one Work Route, and the required fresh Implementer Interactive Session or current-session implementation is selected.

## Start or Verify an Implementer Interactive Session

The Implementer Prompt is optional.
The Change ID and Managed Worktree are already bound to Change Implement.
The captured Task Context and packaged Implementer instructions already provide accepted intent and the implementation procedure.
Provide an Implementer Prompt only when the Implementer needs current information that Change inspection, Task Context, and packaged instructions do not provide.
Do not repeat the Change ID, Task ID, Change state, Managed Worktree path, Task Context, or packaged instructions.
If a fact requires durable authority, record it through the applicable Task or Change operation instead.
Do not include sensitive information.

Use Change Implement with the selected open Change ID.
Use the resolved But Why command prefix for the command.
When no Implementer Prompt is needed, omit `--implementer-prompt-file`.
When an Implementer Prompt is needed, provide its UTF-8 Markdown file with `--implementer-prompt-file <path>`.

```sh
<but-why> change implement <change-id> [--implementer-prompt-file <path>]
```

Change Implement opens or reuses the Managed Worktree workspace.
It starts a named Pi agent through Herdr and submits the initial Change handoff through Herdr.
A successful `started` result confirms that Herdr accepted both native agent readiness and the initial prompt.
`already_active` means that an active named agent was reused without another start or prompt.
For `launch_indeterminate`, inspect the existing Herdr session before taking any recovery action.
Do not retry an uncertain start or initial prompt.
Keep the current session open.

This section is complete when Change Implement reports `started` or `already_active` for the exact Change.

## Command templates

Use CLI `--help` output for exact syntax before executing a command.
The installed command templates are:

```text
by snapshot
by task create --title <title> --file <path|-> [--depends-on <task-id>]...
by task dependencies add <task-id> --depends-on <task-id> [--depends-on <task-id>]...
by task dependencies remove <task-id> --depends-on <task-id> [--depends-on <task-id>]...
by task dependencies replace <task-id> --depends-on <task-id> [--depends-on <task-id>]...
by task dependencies clear <task-id>
by task list [--all] [--state <state>] [--limit <positive integer | all>]
by task show <task-id>
by task approve <task-id>
by task submit <task-id>
by task context <task-id>
by task context draft <task-id>
by task context apply <task-id>
by task cancel <task-id> --reason <reason>
by task-review abandon <review-id> --reason <reason>
by change start [--task <task-id>] [--base <branch>]
by change prepare [<change-id>]
by change list [--all]
by change show [<change-id>]
by change findings [<change-id>]
by change validation-runs [<change-id>]
by validation-run show <validation-run-id>
by validation-run artifact <validation-run-id> <artifact-ref>
by validation-run abandon <validation-run-id> --reason <reason>
by change submit [<change-id>]
by change cancel [<change-id>] --reason <reason>
by change reconcile [<change-id>] [--discard-work]
by change implement [<change-id>] [--implementer-prompt-file <path>]
by change decision add <change-id> --choice "<selected approach>" --rationale "<reason>"
by change blocker raise <change-id> --file <path|->
by change blocker resolve <change-id> --file <path|->
by change blocker list <change-id>
by change decision list <change-id>
```
