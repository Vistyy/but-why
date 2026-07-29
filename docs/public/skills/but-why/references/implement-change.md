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
Record each material Implementation Decision when it is made with `by change decision add <change-id> --file <path>`.
A material decision affects observable behavior, an interface, stored data, failure handling, or a meaningful trade-off.
Do not record routine coding choices.
Implementation Decisions explain rationale only.
They cannot amend Acceptance Context or justify a Candidate that does not satisfy approved intent.
Continue through recoverable problems and local implementation choices.
Raise an Implementation Blocker only when accepted implementation cannot safely continue without external authority or action.
Do not raise a blocker for ordinary difficulty, Findings, tooling recovery, publication recovery, or autonomous Task cancellation.
Stop and report when continuing requires human authority or when the approved intent appears wrong or impossible.
Run only focused tests and relevant focused static checks during implementation.
Do not manually run a repository-wide quality command, complete test suite, coverage workload, or review before Submission.
Change Submit owns the configured blocking Checks and reviews.
If Acceptance Context requires a blocking gate to pass, satisfy that requirement through Change Submit instead of running the gate manually.
After a Check failure, reproduce the reported failure with the narrowest applicable command before changing code or submitting again.
Use the repository's routine quality command only when the failure cannot be reproduced by a narrower supported command.
Never run the complete quality command manually during Change implementation.
Commit one complete Candidate before Submission.

This step is complete when the committed Candidate satisfies the accepted intent and focused verification passes without a manually duplicated blocking Check.
If implementation is blocked, complete this step by raising the blocker and waiting for the main operator's approved Resolution.

## Implementation Blockers

Raise a blocker with `by change blocker raise <change-id> --file <path>`.
The report is non-authoritative evidence and does not amend Acceptance Context.
The main operator inspects the blocker with `by change blocker list <change-id>` and records an approved Resolution with `by change blocker resolve <change-id> --file <path>`.
If the Resolution conflicts with accepted intent, identify the earlier intent that the Resolution replaces.
For a Task-backed Change, the Resolution creates a new Acceptance Context version.
After resolution, the main operator manually tells the Implementer to continue in the same Managed Worktree.
Do not detect, stop, message, or automatically wake an Interactive Session.

## 3. Submit the Candidate

Run `<but-why> change submit <change-id>`.
Change Submit owns Acceptance Review, configured Specialists, the Validation Gate, and eligible publication.
Treat Change Submit as a long-running command.
Run it without a caller timeout when the execution harness supports that behavior.
When the execution harness requires a finite timeout, allow at least 30 minutes.
Increase the timeout when configured phase limits or reviewer duration require more time.
Do not run or delegate a separate review for a Change.
Route all Change review through Change Submit.

If the caller times out or loses the response, inspect the Change, Validation Runs, Findings, and active processes before retrying.
Do not assume that Change Submit stopped when its caller ended.

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
