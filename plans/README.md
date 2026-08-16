# Working plans

Files in this directory are temporary planning records.
They are not current product documentation, approved specifications, accepted architecture, or implementation authority.

Each plan must declare its status and removal condition.
An approved status records operator acceptance but does not make the plan implementation authority.
Agents must use a plan only when the operator or an active Task explicitly identifies it as planning context.

`task-change-boundary.md` is the current Task and Change boundary plan.
`agent-session-execution.md` is approved under that boundary.
`release-baseline-cutover.md` is approved planning direction.
`post-baseline-hardening.md` is the active investigation plan for concerns discovered during the first-release baseline cutover.
`candidate-publication-presentation.md` is deferred until after the first-release baseline.
All other plans are paused unless the Operator explicitly reactivates one after reviewing it against the boundary.

After approval, record each accepted requirement in the smallest applicable authoritative work record, current documentation source, or ADR.
Remove each working plan after those authoritative artifacts contain all required information.
