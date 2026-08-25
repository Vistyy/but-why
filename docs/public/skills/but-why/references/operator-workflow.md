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

## Investigate an Implementation Blocker

Treat an active Implementation Blocker as a red flag that safe continuation requires Operator judgment.
The blocker may report a local implementation problem, an unsupported assumption, an incoherent Task boundary, a conflict with another owner, or a repeated design or workflow problem.
These are non-exhaustive investigation paths, not classifications that limit the investigation.

When an Implementer Interactive Session exists, use `/pause-change` in that session before investigating the blocker, discussing the Change, recording a Resolution, or taking external action.
An Implementer that raises a blocker must stop, and Stall Detection can also transfer control through a blocker after repeated blocked Validation Runs.
Pausing remains necessary because an unpaused session continues polling for a Resolution.

Inspect the complete Acceptance Context when present, current Change state, active blocker and complete Blocker and Resolution history, current Candidate and publication, Validation Run history, Findings, Implementation Decisions, Managed Worktree state, unfinished work, and applicable linked Task evidence.
Use `<but-why> change show <change-id>`, `<but-why> change blocker list <change-id>`, `<but-why> change decision list <change-id>`, `<but-why> change validation-runs <change-id>`, `<but-why> change findings <change-id>`, Git, and the supported Artifact inspection path for the evidence that exists.
The named evidence is orientation rather than a checklist whose completion proves understanding.
Investigate exhaustively until the evidence explains the blocker, its effect on the accepted work, and the consequences of each credible response.
When several Blockers or Findings concern the same mechanism, investigate their shared cause before authorizing another local correction.

When existing evidence cannot resolve a consequential question, run a bounded real-system experiment.
A spike tests one important falsifiable hypothesis.
An integration prototype tests whether several parts work together through their real interfaces, owners, lifecycle states, material failures, and recovery paths.
Use an integration prototype when a smaller experiment cannot answer the decision-driving question.
Before the experiment, state its decision, supporting and refuting observations, stopping condition, permitted effects, and cleanup boundary.
The Operator may create and modify a manually managed disposable workspace under temporary storage without separate authorization.
Do not open live Shared Repository State from a source or Candidate executable.
Obtain additional approval before affecting shared external state or incurring material cost or risk.
Remove the disposable workspace and all experiment-only state after collecting the result.
Use the result only for the decision it was designed to inform.

After investigation, decide whether to keep the Change blocked, gather more evidence, arrange an external action, record a Resolution, cancel or replace the work, or select another Work Route.
The Operator decides whether a Resolution preserves enough of the existing work for the same Task or Change to remain useful.
A Resolution may replace earlier accepted direction, including consequential direction, when the Operator chooses to continue the Change.
State every replacement or addition explicitly rather than silently changing authority.
Do not treat a successful experiment as production implementation or authority to change accepted intent.

Record an approved Resolution with `<but-why> change blocker resolve <change-id> --file <path|->` only after making the decision.
Keep the Interactive Session paused until continuation is safe.
When implementation should resume, use `/continue-change` explicitly so the session receives the Resolution and current Change state.

This section is complete when the blocker remains paused with its next evidence or external action identified, the Change has been redirected or closed through the selected supported operation, or an approved Resolution has been recorded and continuation has been explicitly requested.

## Manage Interactive Session continuation

Change Implement sessions load the packaged `continue-change` extension automatically.
Do not add it to an Agent Profile.

While the bound Change has an active Implementation Blocker, the extension checks for an approved Resolution every 30 seconds.
Inspections do not overlap.
When the extension finds a new Resolution in an unpaused session, it explains the Resolution and automatically resumes the Implementer once for that Resolution.
It explains the Resolution before it directs the Implementer to Findings from an earlier Validation Run.
Polling stops when the Change is no longer blocked or is closed.
A terminal Change does not wake the Implementer.

Use `/pause-change` before discussing a Change with the Implementer, investigating an active blocker, recording a Resolution, or taking an external action.
Pause overrides an inspection that is already in progress.
A Resolution recorded while paused remains pending.

Use `/continue-change` to unpause, refresh the Change state, and continue the bound Change when continuation is safe.
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

## Reconcile a Change

Candidate Publication is not durable Change completion.
After a human confirms that the Change's owned pull request was merged, close its Interactive Session manually when one exists, then run `<but-why> change reconcile <change-id>`.
Reconciliation observes the exact owned pull request and merge facts before completing the Change and any linked Task, then performs terminal cleanup.

Use the complete structured result to determine whether reconciliation completed, remains pending, or was rejected.
When reconciliation reports unavailable merge facts, a remote mismatch, in-progress Submission, or pending cleanup, inspect the exact Change and follow only the returned recovery guidance.
Do not adopt an unrelated pull request or infer completion from a branch, commit, or human report alone.

`--discard-work` is destructive authority for one exact terminal Change and is not part of ordinary merged completion.
Use it only after the Operator explicitly authorizes discarding that Change's recorded work and the exact target has been verified.
If discard cleanup remains pending, retry only with the exact command returned by reconciliation.

This section is complete when reconciliation reports the exact Change completed with cleanup complete, or when its structured result identifies the pending evidence, cleanup, or decision that prevents completion.
