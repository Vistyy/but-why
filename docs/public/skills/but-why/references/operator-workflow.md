# Operator Workflow

Use this reference when selecting a Work Route, recording Tasks, approving a Task, authorizing implementation, or starting a fresh Implementer Interactive Session.
Read target-repository instructions and current repository state before you act.
Use a repository documentation authority map when one exists.
Do not infer documentation authority from a file name, directory, or document label.
Treat historical material only as evidence unless the Operator approves it as a current requirement source.

## Authority

**Work Route Selection** is the Operator's explicit choice of a Task-backed Change, a taskless Change, or a direct edit outside But Why.
You may recommend a Work Route, but you must follow the Operator's selected Work Route.
If the selected Work Route conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent, report the conflict and request direction through the applicable authority mechanism.

**Task Recording Authorization** is the Operator's explicit permission to record agreed Task outcomes and their actual Task Dependencies for one selected work item.
It permits the agent to choose clear Task description wording and encode the actual dependencies within the agreed scope.
It does not permit Task Approval, Change Start, implementation, or Implementation Authorization.

**Task Approval** is a separate Operator action for one recorded Task.
Task Approval does not start a Change or launch implementation.

**Implementation Authorization** is the Operator's explicit permission to implement one selected work item through its selected Work Route.
Task Recording Authorization and Task Approval do not grant Implementation Authorization.
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

1. Gather the Operator-approved outcome, applicable current authority, existing Tasks, and relevant repository evidence for the selected work item.
   Do not infer approval from brainstorming or provisional planning.
   Ask the Operator when the outcome or scope is unclear.
2. Choose only Tasks that each leave one independently acceptable supported result.
   Do not omit or weaken approved behavior to make a Task smaller.
   Split work only when the separate results remain safe, usable, and independently valuable.
   Add a Task Dependency only when the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
3. Describe each Task in whatever form communicates its outcome and consequential constraints clearly.
   Do not require standard headings, a verification inventory, an implementation plan, or an exact file forecast.
   State a special verification constraint only when it is already part of approved intent.
   Otherwise, select proportionate verification during implementation when the implementation shape is known.
4. Present the proposed Task titles and intended outcomes, plus any unresolved choice that affects scope or observable behavior.
   Obtain Task Recording Authorization before any Task or Task Dependency mutation.
   The Operator does not need to approve the exact description wording or dependency encoding.
5. Record the agreed Tasks and only their actual prerequisites.
   Use CLI help for the exact syntax before each command.
   Use a Task Context draft and apply operation for an existing unstarted Task.
6. Treat each successful mutation result as authoritative for its returned committed fields.
   Run Task Show, Task Context, or dependency inspection only when required recording state is omitted from that result.
   Verify every recorded Task remains unapproved and has no Change through the returned state or the applicable inspection command.

This section is complete when the authorized Tasks and Task Dependencies are recorded, unapproved, and unlinked to a Change.

## Review and approve a Task

When the Operator requests an advisory Task Review before approval, run `by task submit <task-id>` for the exact New Task proposal.
A Task Review does not approve the Task.
If Task Submission reports an Active Task Review, inspect it with `by task review show <review-id>`.
If its process has stopped and it cannot finish, use the reported exact abandonment command.
Resolve every applicable Finding by updating the Task proposal before requesting another review.

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
by task submit <task-id>
by task review show <review-id>
by task review abandon <review-id> --reason <reason>
by task approve <task-id>
by task context <task-id>
by task context draft <task-id>
by task context apply <task-id>
by task cancel <task-id> --reason <reason>
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
