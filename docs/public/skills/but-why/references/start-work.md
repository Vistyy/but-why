# Start Work

Use this procedure when selecting a Work Route, authorizing implementation, starting a Change, or starting an Implementer Interactive Session.
Let `<but-why>` represent the command prefix resolved by the But Why command guidance.

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

## Authorize implementation

Implementation Authorization is the Operator's explicit permission to implement one selected work item through its selected Work Route.
Task Recording Authorization and Task Submission do not grant it.
When the Operator gives Implementation Authorization, confirm the selected work item and Work Route before acting.

For a direct edit, implement only the authorized work in the current repository according to target-repository instructions.
A direct edit does not start a Change, run But Why validation, publish a pull request, or launch an Interactive Session.

For a Change linked to a Task, confirm that the selected Task is approved and start or resume its Change with `<but-why> change start --task <task-id>`.
Then start or verify the Change's Implementer Interactive Session.

For a Change without a Task, start it with `<but-why> change start` and keep implementation in the current session unless the authorization explicitly requests a separate Implementer Interactive Session.
A separate Implementer Interactive Session runs outside the current Operator session.
It may reuse the Change's matching Done agent with a new initial handoff and does not require a new agent identity.

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
