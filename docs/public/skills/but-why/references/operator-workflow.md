# Operator Workflow

Use this reference when selecting a Work Route, recording or submitting Tasks, authorizing implementation, starting an Implementer Interactive Session, or managing Interactive Session continuation.
Read target-repository instructions, current repository state, and any repository documentation authority map before acting.
When no map identifies an artifact's authority, do not infer authority from its name or path.
Treat historical material only as evidence unless the Operator approves it as a current requirement source.

## Authority

Work Route Selection is the Operator's explicit choice of a Change linked to a Task, a Change without a Task, or a direct edit.
Task Recording Authorization permits recording agreed Task outcomes and actual Task Dependencies, but does not permit Task Submission, Change Start, or implementation.
Task Submission Authorization permits submission of one selected New Task proposal for Task Review toward a passing Task Review and transition to Todo.
It is distinct from Task Recording Authorization and Implementation Authorization and is not persisted.
Each selected Task requires new Task Submission Authorization.
Task Submission does not start a Change or authorize implementation.
Implementation Authorization permits implementation of one selected work item through its selected Work Route.
Do not start a Change or begin implementation without Implementation Authorization for that work item.

## Select a Work Route

1. Read the requested outcome, applicable authority, and current Task ownership.
   Resolve consequential uncertainty before splitting Tasks or implementing affected work.
   Ask the Operator when repository evidence cannot resolve an uncertainty that could change Task boundaries, observable behavior, or implementation.
2. Recommend a Work Route.
   Use a Change linked to a Task for durable approved intent, a Change without a Task for a validated code change without Task intent, or a direct edit when But Why is not required.
3. Obtain the Operator's explicit Work Route Selection.
   Follow the selected route unless it conflicts with a higher-priority instruction, supported interface, safety constraint, or approved Task intent.
   Report such a conflict and request direction instead of substituting another route.

This section is complete when the selected work item and Work Route are explicit.

## Author Tasks

1. Gather the Operator-approved outcome, applicable authority, existing Tasks, and relevant repository evidence.
   Ask the Operator when the outcome or scope is unclear.
2. Apply [Task authoring](task-authoring.md) to compose or revise the proposed Tasks and their actual Task Dependencies.
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
Use the returned Review state and outcome, and help, to identify the result and valid next action.
If Task Submission reports an Active Task Review, inspect it with `<but-why> task-review show <review-id>`.
If its process has stopped and it cannot finish, use the reported exact abandonment command.
Run `<but-why> task reviews <task-id>` to inspect ordered Task Review history and valid next actions.
Run `<but-why> task-review show <review-id>` to inspect one Review's proposal, executed reviewer configuration when available, outcome, Findings or Tooling Failure, recovery state, Agent Session, Invocations, and Continuations.
A Review with no linked Invocation reports no executed reviewer configuration or Agent Session.
Resolve every applicable Finding by updating the New Task proposal before requesting another Review, or submit the unchanged New Task again when a new Task Submission is authorized.

Task Submission is the only supported route that can approve an unlinked New Task.
Task Submission does not authorize Change Start or implementation.

This section is complete when the selected Task is approved and no Change has started from this action.

## Authorize implementation

Implementation Authorization is the Operator's explicit permission to implement one selected work item through its selected Work Route.
Task Recording Authorization and Task Submission do not grant it.
When the Operator gives Implementation Authorization, confirm the selected work item and Work Route before acting.

For a direct edit, implement only the authorized work in the current repository according to target-repository instructions.
A direct edit does not start a Change, run But Why validation, publish a pull request, or launch an Interactive Session.

For a Change linked to a Task, confirm that the selected Task is approved and start or resume its Change with `<but-why> change start --task <task-id>`.
Then start or verify the Change's Implementer Interactive Session.

For a Change without a Task, start it with `<but-why> change start` and keep implementation in the current session unless the authorization explicitly requests a separate Implementer Interactive Session.

This section is complete when a direct edit is authorized or the exact Open Change and required session behavior are established for the selected work item.

## Start or verify an Implementer Interactive Session

The Implementer Prompt carries current non-authoritative information that Change inspection and packaged instructions do not supply.
For a Change linked to a Task, the captured Acceptance Context supplies accepted intent, so provide a prompt only for additional current information.
For a separate Interactive Session for a Change without a Task, provide a prompt that states the authorized implementation outcome and applicable constraints because the Change has no Acceptance Context.
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
When the matching named agent is Done, Change Implement reuses it and submits the initial handoff without starting another agent.
`started` confirms that Herdr accepted agent readiness and the initial prompt for a new or reused Done agent.
`already_active` confirms that the active named agent was reused without another start or prompt.
For `launch_indeterminate`, inspect the existing Herdr session and do not retry the uncertain start or prompt.
Keep the current session open.

This section is complete when Change Implement reports `started` or `already_active` for the exact Change.

## Manage Interactive Session continuation

Change Implement sessions load the packaged `continue-change` extension automatically.
Do not add it to an Agent Profile.

While the bound Change has an active Implementation Blocker, the extension checks for an approved Resolution every 30 seconds.
Inspections do not overlap.
When the extension finds a new Resolution in an unpaused session, it explains the Resolution and automatically resumes the Implementer once for that Resolution.
It explains the Resolution before it directs the Implementer to Findings from an earlier Validation Run.
Polling stops when the Change is no longer blocked or is closed.
A terminal Change does not wake the Implementer.

Use `/pause-change` in the Interactive Session before discussing a Change with the Implementer or taking an external action.
Pause overrides an inspection that is already in progress.
A Resolution recorded while paused remains pending.

Use `/continue-change` in the Interactive Session to unpause when needed, refresh the Change state, and continue the bound Change when continuation is safe.
Repeated `/continue-change` commands keep continuation unpaused.
A pending Resolution is handled when the Operator explicitly continues or when the Interactive Session starts unpaused.
If automatic continuation is unavailable, tell the Implementer to continue after recording the Resolution.

If inspection fails, `/continue-change` retries the local inspection and reports the recovery action.
A Validation Tooling Failure receives recovery guidance only after the Operator runs `/continue-change`.

The continuation widget reports when the Change is blocked, implementing a revision, validating a revision, or waiting for human review.
When a publication has a pull request URL, the widget includes that URL while waiting for human review and during later revision implementation or validation.
Automatic continuation waits while the exact current Candidate remains published.
Under the Operator's direct instruction, `/continue-change` resumes revision work for a published Change.

This section is complete when the extension is in the state required for the Operator's next action.
