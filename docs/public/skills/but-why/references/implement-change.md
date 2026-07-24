# Implement a Change

The handoff identifies one ready Change and its Managed Worktree.
Let `<but-why>` represent the command prefix resolved by the `but-why` skill.

## 1. Read the accepted context

Run `<but-why> change show <change-id> --output json`.
For a Task-backed Change, run `<but-why> task context <task-id> --output json`.
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

Run `<but-why> change submit <change-id> --output json`.
Change Submit owns Acceptance Review, configured Specialists, the Validation Gate, and eligible publication.
Use Change Submit instead of a separate generic code-review lifecycle.

When Change Submit returns Findings, run `<but-why> change findings <change-id> --output json`.
Fix every applicable Finding in the Managed Worktree.
Commit the fixes and run Change Submit again.
Repeat this loop until the exact Candidate publishes or a tooling failure blocks trustworthy validation.
Report a tooling failure with its structured recovery guidance.

This step is complete when Change Submit reports the owned pull request for the exact passing Candidate.

## 4. Complete after human merge

Ask a human to merge the owned pull request.
But Why does not merge pull requests.
After the human confirms the merge, run `<but-why> change reconcile <change-id> --output json`.
Inspect the Task and Change when reconciliation reports pending or unsafe cleanup.

This workflow is complete when reconciliation records durable completion and reports the Managed Worktree cleanup state.
