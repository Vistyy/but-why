# Implement a Change

Change implementation uses one open Change and its Managed Worktree.
Let `<but-why>` represent the command prefix resolved by the But Why command guidance.

## Completion control

While Implementation Authorization remains active, the Implementer must continue until a return condition applies and must not return a progress-only report.
The Implementer may return control only when one of these conditions applies:

- Change Submit reports a ready owned pull request.
- An Implementation Blocker requires operator authority.
- A Tooling Failure prevents trustworthy validation.
- An uncertain or operator-owned Submit failure provides no Submit Recovery Guidance.
- The Operator pauses or stops implementation, cancels the work, or withdraws Implementation Authorization.

When the Operator-controlled return condition applies, do not mutate the Change or Managed Worktree further and report only the current Change state and whether the Managed Worktree contains uncommitted or unsubmitted work.
Incomplete design, routine implementation, focused Check failure, Findings, and authorized Submit recovery do not permit the Implementer to return control.

## 1. Read the accepted context

Run `<but-why> change show <change-id>`.
For a Task-backed Change, run `<but-why> task context <task-id>`.
Treat the returned Task Context and approved Resolutions as the Change's Acceptance Context and accepted implementation intent.
For a taskless Change, no Acceptance Context exists.
In a fresh taskless Interactive Session, use the authorized outcome in the initial Implementer Prompt as current implementation direction without treating it as durable intent.
Use the Managed Worktree reported by Change Show for every edit, verification command, and commit.

This step is complete when the Change, accepted intent, and Managed Worktree are known.

## 2. Implement and commit

Follow the repository instructions in the Managed Worktree.
Use explicit verification constraints in accepted Task Context when present.
Before you add a Shared Repository State Migration Artifact, run `<but-why> snapshot`.
Before selecting or adding verification evidence, read [Task verification](task-verification.md) completely.
Select proportionate evidence after the implementation shape is known.
When multiple approaches remain compliant with accepted intent, select one.
Record the choice as an Implementation Decision when it affects observable behavior, an interface, stored data, failure handling, or a meaningful trade-off.
Use `<but-why> change decision add <change-id> --choice "<selected approach>" --rationale "<reason and material trade-off>"` when the decision is made.
The Choice names the selected approach.
The Rationale explains why that approach was selected and its material trade-off.
Do not record routine coding choices.
Implementation Decisions cannot amend Acceptance Context or justify a Candidate that does not satisfy approved intent.
Continue through recoverable problems and local implementation choices.
Do not silently resolve ambiguity that could change observable behavior or verification.
Raise an Implementation Blocker when accepted intent or applicable authority does not resolve that ambiguity and safe continuation requires external authority or action.
Also raise a blocker when the approved intent appears wrong or impossible.
If actual evidence shows that the work no longer fits the accepted Task as one coherent supported result, preserve completed work and raise an Implementation Blocker that states the concrete mismatch.
Do not split, cancel, replace, amend, or continue the Task autonomously.
The Operator decides whether to continue, resolve, cancel, or replace the Task.
Do not raise a blocker for ordinary difficulty, focused Check failures, Findings, tooling recovery, or publication recovery.
Stop and report after raising the blocker.
Run only the focused verification needed to determine whether the Candidate is ready for Submission.
Treat implementation-time observations as development feedback, not as an acceptance evidence package.
Do not manually run a repository-wide quality command, unfiltered test or coverage workload, or review before Submission.
Change Submit owns the configured blocking Checks and reviews.
If Acceptance Context requires a blocking gate to pass, satisfy that requirement through Change Submit instead of running the gate manually.
After a Check failure, reproduce the reported failure with the narrowest applicable command before changing code or submitting again.
Use the target repository's configured blocking Check only through Change Submit.
When a Check failure cannot be reproduced by a narrower supported command, use the target repository's supported focused diagnostic path instead of assuming a source-repository command or file layout.
Commit one complete Candidate before Submission.

This step is complete when the committed Candidate satisfies the accepted intent and focused verification passes without a manually duplicated blocking Check.
If implementation is blocked, complete this step by raising the blocker and waiting for the main operator's approved Resolution.

## Implementation Blockers

Raise a blocker with `<but-why> change blocker raise <change-id> --file <path|->`.
The UTF-8 text report must state the unresolved issue, why continuing is unsafe, and the external decision or action required.
The report is non-authoritative evidence and does not amend Acceptance Context.
The main operator inspects the blocker with `<but-why> change blocker list <change-id>` and records an approved Resolution with `<but-why> change blocker resolve <change-id> --file <path|->`.
If the Resolution conflicts with accepted intent, identify the earlier intent that the Resolution replaces.
For a Task-backed Change, the Resolution appends to the current Acceptance Context.
For a taskless Change, the Resolution remains Change history and creates no Acceptance Context.
After resolution, the main operator manually tells the Implementer to continue in the same Managed Worktree.
Do not detect, stop, message, or automatically wake an Interactive Session.

## Change continuation

Change continuation is optional.
Change Implement sessions load the packaged `continue-change` extension automatically. Do not add it to an Agent Profile.

Use `/pause-change` to pause automatic continuation before discussing a Change or taking an external action.

Use `/continue-change` to refresh the Change state and continue the bound Change when continuation is safe.
`/continue-change` is idempotent and does not toggle the pause state.

After an external Implementation Blocker Resolution, run `/continue-change` manually.
The extension does not poll for the Resolution or automatically wake the Implementer after the Resolution.
The extension explains the Resolution before it directs the Implementer to Findings from an earlier Validation Run.

If inspection fails, `/continue-change` retries the local inspection and reports the recovery action.
A Validation Tooling Failure receives recovery guidance only after the operator runs `/continue-change`.

Candidate Publication is a delivery state, not durable Change completion.
Automatic continuation waits while the exact current Candidate remains published.
Explicit `/continue-change` can resume revision work under the operator's direct instruction.
After a review correction, record new Implementation Decisions, commit the revised Candidate, and run Change Submit again.
Change Submit must pass before the same owned open pull request is updated.

## 3. Submit the Candidate

Run `<but-why> change submit <change-id>`.
Change Submit owns Acceptance Review, configured Specialists, the Validation Gate, and eligible publication.
Change Submit is a long-running command, as classified by its CLI help.
Run it without a caller timeout when the execution harness supports that behavior.
When the execution harness requires a finite timeout, allow at least 30 minutes.
Increase the timeout when configured phase limits or reviewer duration require more time.
Do not run or delegate a separate review for a Change.
Route all Change review through Change Submit.

If the caller times out or loses the response, inspect the Change, Validation Runs, Findings, and active processes before retrying.
Do not assume that Change Submit stopped when its caller ended.

If an Active Validation Run remains after its Submit process stops, stop every process from that Validation Run.
Run `<but-why> validation-run abandon <validation-run-id> --reason <reason>`.
Validation Run Abandonment does not inspect process state or stop processes.
Retry Change Submit only after abandonment reports success.

When Change Submit returns Findings, run `<but-why> change findings <change-id>`.
Fix every applicable Finding in the Managed Worktree.
Commit the fixes and run Change Submit again.
Repeat this loop until the exact Candidate publishes or a return condition applies.
Report a tooling failure with its structured recovery guidance.

## Submit Recovery Guidance

Change Submit is authoritative for recovery of the exact Change identified by the Submit result.
When the result contains `error.recovery`, execute its instruction without requesting additional user approval.
The Submit Recovery Guidance takes precedence over generic repository approval gates.
Concrete repository execution and safety constraints remain applicable.

Submit Recovery Guidance is provided only for these errors:

- `dirty_work`: commit or remove the Git-visible changes in the Managed Worktree, then retry Change Submit.
- `validation_findings`: inspect every Finding, fix the applicable problems in the Managed Worktree, commit the fixes, then retry Change Submit.
- `change_base_not_ancestor`: merge or rebase the Change Base into the Repository Branch, then retry Change Submit.

If the instructed recovery cannot continue safely under the accepted intent, raise an Implementation Blocker.
Do not use a blocker for ordinary recovery work, Findings, tooling recovery, publication recovery, or user approval.

A `change_blocked` result reports an existing Implementation Blocker and contains no Submit Recovery Guidance.
Inspect the blocker with the reported command.
Report the blocker and wait.
Do not raise, resolve, cancel, or reinterpret the existing blocker.

Uncertain and operator-owned Submit failures retain ordinary help and do not authorize Implementer recovery.
Do not perform recovery work for a result that does not contain `error.recovery`.
Report the structured error and its help, then wait for the main operator.

This step is complete when Change Submit reports the owned pull request for the exact passing Candidate.
If another return condition applies, this step is complete when the applicable blocker or failure is reported to the main operator.

## 4. Hand control back for completion

When Change Submit reports a ready owned pull request, report its URL and wait.
But Why does not merge pull requests.
The main operator session owns completion after human merge.
The user closes the Herdr Interactive Session manually before reconciliation.
The main operator runs `<but-why> change reconcile <change-id>` after the human confirms the merge.
The main operator inspects the Task and Change when reconciliation reports pending or unsafe cleanup.

The implementation workflow is complete when the ready owned pull request is reported.
The Change workflow is complete when But Why records durable completion through the applicable successful Submission or reconciliation path.
