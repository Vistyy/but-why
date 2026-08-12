# Operator Workflow

Use this reference when selecting a Work Route, recording Tasks, approving a Task, authorizing implementation, or starting an Implementer Interactive Session.
Read target-repository instructions, current repository state, and any repository documentation authority map before acting.
When no map identifies an artifact's authority, do not infer authority from its name or path.
Treat historical material only as evidence unless the Operator approves it as a current requirement source.
Use CLI help to confirm exact command syntax before execution.

## Authority

Work Route Selection is the Operator's explicit choice of a Task-backed Change, a taskless Change, or a direct edit.
Task Recording Authorization permits recording agreed Task outcomes and actual Task Dependencies, but does not permit Task Approval, Change Start, or implementation.
Task Approval confirms one recorded Task without starting a Change or authorizing implementation.
Implementation Authorization permits implementation of one selected work item through its selected Work Route.
Do not start a Change or begin implementation without Implementation Authorization for that work item.

## Select a Work Route

1. Read the requested outcome, applicable authority, and current Task ownership.
   Resolve consequential uncertainty before splitting Tasks or implementing affected work.
   Ask the Operator when repository evidence cannot resolve an uncertainty that could change Task boundaries, observable behavior, or implementation.
2. Recommend a Work Route.
   Use a Task-backed Change for durable approved intent, a taskless Change for a validated code change without Task intent, or a direct edit when But Why is not required.
3. Obtain the Operator's explicit Work Route Selection.
   Follow the selected route unless it conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent.
   Report such a conflict and request direction instead of substituting another route.

This section is complete when the selected work item and Work Route are explicit.

## Author Tasks

1. Gather the Operator-approved outcome, applicable authority, existing Tasks, and relevant repository evidence.
   Do not infer approval from brainstorming or provisional planning.
   Ask the Operator when the outcome or scope is unclear.
2. Choose Tasks that each leave one independently acceptable supported result.
   Do not omit or weaken approved behavior to make a Task smaller.
   Split work only when each result remains safe, usable, and independently valuable.
   Add a Task Dependency only when the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
3. Describe each Task in the form that communicates its outcome and consequential constraints clearly.
   Do not require standard headings, a verification inventory, an implementation plan, or an exact file forecast.
   State a special verification constraint only when it is already part of approved intent.
   Otherwise select proportionate verification during implementation.
4. Present the proposed Task titles, intended outcomes, actual dependencies, and unresolved choices that affect scope or observable behavior.
5. Obtain Task Recording Authorization before mutating any Task or Task Dependency.
   This authorization permits clear description wording and dependency encoding within the agreed scope.
   It does not authorize Task Approval, Change Start, or implementation.
6. Record the agreed Tasks and only their actual prerequisites.
   Use a Task Context draft and apply operation for an existing unstarted Task.
7. Treat each successful mutation result as authoritative for its returned committed fields.
   Use an inspection command only when the result omits required recording state.
   Verify that every recorded Task remains unapproved and unlinked to a Change.

This section is complete when the authorized Tasks and Task Dependencies are recorded, unapproved, and unlinked to a Change.

## Review and approve a Task

When the Operator requests an advisory Task Review, run `<but-why> task submit <task-id>` for the exact New Task proposal.
A Task Review does not approve the Task.
If Task Submission reports an Active Task Review, inspect it with `<but-why> task-review show <review-id>`.
If its process has stopped and it cannot finish, use the reported exact abandonment command.
Run `<but-why> task reviews <task-id>` to inspect ordered Task Review history and valid next actions.
Run `<but-why> task-review show <review-id>` to inspect one Review's proposal, policy, outcome, Findings or Tooling Failure, recovery state, sessions, and transcripts.
Resolve every applicable Finding by updating the Task proposal before requesting another review.

When the Operator explicitly requests Task Approval, inspect the selected Task and run `<but-why> task approve <task-id>`.
Treat the returned Task state as authoritative.
Inspect the Task again only when the result omits required approval or Change-link state.
Task Approval does not authorize Change Start or implementation.

This section is complete when the selected Task is approved and no Change has started from this action.

## Authorize implementation

Implementation Authorization is the Operator's explicit permission to implement one selected work item through its selected Work Route.
Task Recording Authorization and Task Approval do not grant it.
When the Operator gives Implementation Authorization, confirm the selected work item and Work Route before acting.

For a direct edit, implement only the authorized work in the current repository according to target-repository instructions.
A direct edit does not start a Change, run But Why validation, publish a pull request, or launch an Interactive Session.

For a Task-backed Change, confirm that the selected Task is approved and start or resume its Change with `<but-why> change start --task <task-id>`.
Then start or verify a fresh Implementer Interactive Session.

For a taskless Change, start it with `<but-why> change start` and keep implementation in the current session unless the authorization explicitly requests a fresh Implementer Interactive Session.

This section is complete when a direct edit is authorized or the exact Open Change and required session behavior are established for the selected work item.

## Start or verify an Implementer Interactive Session

The Implementer Prompt carries current non-authoritative information that Change inspection and packaged instructions do not supply.
For a Task-backed Change, the captured Task Context supplies accepted intent, so provide a prompt only for additional current information.
For a fresh taskless Interactive Session, provide a prompt that states the authorized implementation outcome and applicable constraints because the Change has no Task Context.
Do not repeat bound identifiers, state, accepted context, or packaged instructions.
Record facts that require durable authority through the applicable Task or Change operation.
Do not include sensitive information.

Run Change Implement with the selected Open Change ID.
Omit `--implementer-prompt-file` when no Implementer Prompt is needed.
Otherwise provide a UTF-8 Markdown file.

```sh
<but-why> change implement <change-id> [--implementer-prompt-file <path>]
```

Change Implement opens or reuses the Managed Worktree workspace, starts a named Pi agent through Herdr, and submits the initial handoff.
`started` confirms that Herdr accepted agent readiness and the initial prompt.
`already_active` confirms that the active named agent was reused without another start or prompt.
For `launch_indeterminate`, inspect the existing Herdr session and do not retry the uncertain start or prompt.
Keep the current session open.

This section is complete when Change Implement reports `started` or `already_active` for the exact Change.
