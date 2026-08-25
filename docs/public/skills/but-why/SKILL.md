---
name: but-why
description: Use when setting up or operating But Why, selecting a But Why Work Route, authoring Tasks, authorizing or implementing work, controlling a Change, or submitting a Candidate.
---

# But Why

This skill is the portable workflow authority for But Why Operators and Implementers.
It does not require target-repository private instructions or other local skills.

Select guidance from the responsibility of the next action.
A session may move between Operator and Implementer responsibilities as its work changes.
Do not infer the current responsibility from a Change association, a Managed Worktree, or session location.
Reviewer Agent Sessions receive their role-specific instructions from But Why and do not use these Operator or Implementer procedures as review authority.

Before running a But Why command, read [Command guidance](references/command-guidance.md) completely.
Before setup guidance, read [Setup guidance](../../setup.md) completely.

For Operator responsibility:

Work Route Selection is the Operator's explicit choice of a Change linked to a Task, a Change without a Task, or a direct edit.
Task Recording Authorization permits recording agreed Task outcomes and actual Task Dependencies, but does not permit Task Submission, Change Start, or implementation.
Task Submission Authorization permits submission of one selected New Task proposal for Task Review toward a passing Task Review and transition to Todo.
It is distinct from Task Recording Authorization and Implementation Authorization and is not persisted.
Each selected Task requires new Task Submission Authorization.
Task Submission does not start a Change or authorize implementation.
Implementation Authorization permits implementation of one selected work item through its selected Work Route.
Do not start a Change or begin implementation without Implementation Authorization for that work item.

Read target-repository instructions, current repository state, and any repository documentation authority map before acting.
When no map identifies an artifact's authority, do not infer authority from its name or path.
Treat historical material only as evidence unless the Operator approves it as a current requirement source.

- Before authoring, revising, recording, or submitting a Task, read [Task operations](references/task-operations.md) completely.
- Before selecting a Work Route, authorizing implementation, starting a Change, or starting an Implementer Interactive Session, read [Start work](references/start-work.md) completely.
- Before pausing, continuing, or monitoring an Implementer Interactive Session, read [Interactive Session](references/interactive-session.md) completely.
- Before investigating or resolving an Implementation Blocker, read [Blocker triage](references/blocker-triage.md) completely.
- Before reconciling a Change after its pull request is merged, read [Reconcile a Change](references/reconcile-change.md) completely.

Read only the procedure required for the next Operator action.

For Implementer responsibility:

- Before inspecting or changing a Managed Worktree, implementing a Change, correcting Findings, or submitting a Candidate, read [Implement a Change](references/implement-change.md) completely and follow it.
- When selecting implementation evidence, read [Implementation verification](references/implementation-verification.md) completely under the condition stated by Implement a Change.
