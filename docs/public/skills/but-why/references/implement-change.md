# Implement a Change

The handoff identifies one ready Change and its Managed Worktree.
Let `<but-why>` represent the command prefix resolved by the `but-why` skill.

## 1. Read the accepted context

Run `<but-why> change show <change-id>`.
For a Task-backed Change, run `<but-why> task context <task-id>`.
Treat the Task Context captured at Change Start as the accepted implementation intent.
Use the Managed Worktree reported by Change Show for every edit, test, and commit.

This step is complete when the Change, accepted intent, readiness, and Managed Worktree are known.

## 2. Implement and commit

Follow the repository instructions in the Managed Worktree.
Use test-driven development at the applicable public seams.
Run focused tests and relevant static checks after each implementation step.
Commit one complete Candidate before Submission.

This step is complete when the committed Candidate satisfies the accepted intent and focused verification passes.

## 3. Submit the Candidate

Run `<but-why> change submit <change-id>`.
Change Submit owns Acceptance Review, configured Specialists, the Validation Gate, and eligible publication.
Do not run or delegate a separate review for a Change.
Route all Change review through Change Submit.

When Change Submit returns Findings, run `<but-why> change findings <change-id>`.
Fix every applicable Finding in the Managed Worktree.
Commit the fixes and run Change Submit again.
Repeat this loop until the exact Candidate publishes or a tooling failure blocks trustworthy validation.
Report a tooling failure with its structured recovery guidance.

This step is complete when Change Submit reports the owned pull request for the exact passing Candidate.

## 4. Hand control back for completion

Report the ready owned pull request and wait.
But Why does not merge pull requests.
The main operator session owns completion after human merge.
The user closes the Herdr Interactive Session manually before reconciliation.
The main operator runs `<but-why> change reconcile <change-id>` after the human confirms the merge.
The main operator inspects the Task and Change when reconciliation reports pending or unsafe cleanup.

The implementation workflow is complete when the ready owned pull request is reported.
The Change workflow is complete when the main operator records durable completion through reconciliation.
