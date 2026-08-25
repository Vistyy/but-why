# Blocker Triage

Use this procedure when investigating or resolving an Implementation Blocker.
Let `<but-why>` represent the command prefix resolved by the But Why command guidance.

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

This procedure is complete when the blocker remains paused with its next evidence or external action identified, the Change has been redirected or closed through the selected supported operation, or an approved Resolution has been recorded and continuation has been explicitly requested.
