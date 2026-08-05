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

**Task Recording Authorization** is the Operator's explicit permission to record one complete proposed Task graph.
It permits only the approved Task Context and Task Dependency mutations.
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
3. Recommend the smallest suitable Work Route.
   Use a Task-backed Change for durable approved intent, a taskless Change for a validated code change without Task intent, or a direct edit when But Why is not required.
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
   Compare every approved requirement with the proposed graph and give each requirement exactly one Task owner.
   Do not omit, replace, defer, or reduce approved behavior to make a Task smaller.
   Treat any such proposal as a requirements change that requires an explicit Operator decision.
   Each proposed Task must deliver one independently verifiable observable capability.
   Keep all work for one capability in one Task unless a split creates independently verifiable capabilities with necessary dependencies.
   Keep the capability in one Task when no such split exists, even when the Task is large.
   Add a Task Dependency only when the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
3. Give each proposed Task behavior-based acceptance criteria and a complete Task Verification Contract.
   Do not use generic verification gates, test counts, coverage targets, or unsupported test categories as acceptance criteria.
   Follow the Task verification reference to define proportionate implementation confidence.
4. Before requesting Task Recording Authorization for a consequential multi-Task graph, independently audit the exact final Task Contexts and dependencies against current authority, ownership, verification feasibility, and cross-Task overlap.
   Task lifecycle state does not establish implementation readiness.
5. Present the complete Task graph, Task Context, Task Dependency rationale, and recording order.
   Obtain Task Recording Authorization before any Task or Task Dependency mutation.
6. Record only the authorized Task Context and Task Dependencies.
   Use CLI help for the exact syntax before each command.
   Create Tasks in the authorized recording order and set each complete dependency set.
   Use a Task Context draft and apply operation for an existing unstarted Task.
7. Treat each successful mutation result as authoritative for its returned committed fields.
   Run Task Show, Task Context, or dependency inspection only when required recording state is omitted from that result.
   Verify every recorded Task remains unapproved and has no Change through the returned state or the applicable inspection command.

This section is complete when every authorized Task and Task Dependency is recorded, unapproved, and unlinked to a Change.

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

Resolve `scripts/start-implementer-session.mjs` relative to this skill directory.
For a Task-backed Change, run it with `--task-id <task-id>`.
The script reads the Task, reuses its linked Change or starts one, then derives and verifies the exact open Change and Managed Worktree.
For an explicitly authorized fresh taskless Implementer Interactive Session, run it with `--change-id <change-id>`.
When no Implementer Prompt is needed, run the script with empty standard input.
When an Implementer Prompt is needed, pipe only that Markdown to the script with the runner that matches the resolved But Why command prefix.

```sh
node <skill-directory>/scripts/start-implementer-session.mjs \
  --runner <just|pnpx|npx> \
  --task-id <task-id> </dev/null
```

The script verifies the exact Change and Managed Worktree before it runs Change Implement and after launch.
Accept `started`, `already_active`, or `late_active` only when `changeVerified` is `true`.
`started` confirms But Why dispatch and the named Interactive Session, but it does not confirm that Pi is active or ready.
For any other result, report the structured result and diagnostic paths, then stop.
Do not retry an indeterminate launch.
Keep the current session open.

This section is complete when the script reports an accepted Implementer Interactive Session result with `changeVerified: true`.

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
by task context <task-id>
by task context draft <task-id>
by task context apply <task-id>
by task comment <task-id> --file <path|->
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
by change reconcile [<change-id>]
by change implement [<change-id>] [--implementer-prompt-file <path>]
by change decision add <change-id> --choice "<selected approach>" --rationale "<reason>"
by change blocker raise <change-id> --file <path|->
by change blocker resolve <change-id> --file <path|->
by change blocker list <change-id>
by change decision list <change-id>
```
