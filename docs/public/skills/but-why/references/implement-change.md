# Implement a Change

This procedure applies while performing Implementer responsibility for one open Change and its Managed Worktree.
Let `<but-why>` represent the command prefix resolved by the But Why command guidance.

## Completion control

While Implementation Authorization remains active, continue until a return condition applies and do not return a progress-only report.
Return control only when one of these conditions applies:

- Change Submit reports a ready owned pull request.
- An Implementation Blocker requires external authority or action.
- A Tooling Failure prevents trustworthy validation.
- An uncertain or externally controlled Submit failure provides no Submit Recovery Guidance.
- The Operator pauses or stops implementation, cancels the work, or withdraws Implementation Authorization.

When a return condition applies, do not mutate the Change or Managed Worktree further.
Report the return condition, current Change state, whether the Managed Worktree contains uncommitted or unsubmitted work, the exact external action required when applicable, and any new material Implementation Decisions.
Do not include unrelated progress or implementation detail.
Incomplete design, routine implementation, focused Check failure, Findings, and authorized Submit recovery are not return conditions.

## 1. Read the implementation direction

Run `<but-why> change show <change-id>`.
For a Change linked to a Task, use the complete `acceptanceContext` in the Change inspection as the accepted implementation intent.
For a Change without a Task, no Acceptance Context exists.
When the current session implements a Change without a Task, use the exact authorized outcome established in the current Operator conversation as implementation direction.
When a separate Interactive Session implements a Change without a Task, use the authorized outcome in the initial Implementer Prompt as implementation direction without treating it as durable intent.
Use the Managed Worktree reported by Change Show for every edit, verification command, and commit.

This step is complete when the Change, implementation direction, and Managed Worktree are known.

## 2. Investigate and implement

Follow the repository instructions in the Managed Worktree.
Use explicit verification constraints in accepted Acceptance Context when present.
Before selecting or adding implementation evidence, read [Task verification](task-verification.md) completely.
Select proportionate evidence after the implementation shape is known.

Inspect repository evidence before selecting an approach.
When an unanswered feasibility, integration, performance, lifecycle, or recovery question could materially change the implementation direction, use a bounded real-system experiment before requesting external guidance when existing authority permits it.
A spike tests one important falsifiable hypothesis.
An integration prototype tests whether several parts work together through their real interfaces, owners, lifecycle states, material failures, and recovery paths.
Use an integration prototype when a smaller experiment cannot answer the decision-driving question.

Before an experiment, state the decision it informs, the result that would support or refute the hypothesis, the stopping condition, the permitted state changes, and the cleanup boundary.
Implementation Authorization permits reversible experiments in the Managed Worktree that remain within the authorized outcome.
Obtain additional approval before affecting shared external state, incurring material cost or risk, or acting outside the authorized boundary.
If the question itself requires changing accepted intent, Task boundaries, or another Operator-owned decision, raise an Implementation Blocker before running the experiment.
If an otherwise authorized experiment unexpectedly shows that such a decision is required, preserve the evidence, raise a blocker, and stop.
Stop experimenting when the evidence supports a sound compliant direction.
Do not keep comparing credible approaches merely to prove that one is globally optimal.

Experiment-created code may become part of the Candidate only after it is deliberately completed as the supported implementation.
Remove shortcuts and incomplete assumptions, satisfy the complete implementation direction, handle material failures, and verify the resulting Candidate.
Remove experiment-only state that the implementation does not require.

When multiple approaches remain compliant with implementation direction, select one.
When implementation gives an existing capability a second current consumer or duplicates mechanics that enforce the same invariant, inspect the capability owner and directly affected callers before naming or placing the behavior.
Share only mechanics that the current consumers demonstrably have in common, and keep distinct policy, lifecycle, results, and persistence with their owners.
Do not generalize for hypothetical reuse or code similarity alone.

Record a choice as an Implementation Decision when it affects observable behavior, an interface, stored data, failure handling, or a meaningful trade-off.
Use `<but-why> change decision add <change-id> --choice "<selected approach>" --rationale "<reason and material trade-off>"` when the decision is made.
The Choice names the selected approach.
The Rationale explains why that approach was selected and its material trade-off.
Do not record routine coding choices.
An Implementation Decision records non-authoritative rationale and cannot amend Acceptance Context.
Do not return control only to discuss an Implementation Decision.
Summarize new material Implementation Decisions the next time another return condition requires a report.

Continue through recoverable problems and local implementation choices.
Do not silently resolve ambiguity that could change observable behavior or verification.
Raise an Implementation Blocker when implementation cannot safely continue under current authority without an external decision or action.
Also raise a blocker when the approved intent appears wrong or impossible, or evidence shows that the work no longer fits the accepted Task as one coherent supported result.
Do not split, cancel, replace, amend, resolve, or continue blocked work autonomously.
Do not raise a blocker for ordinary difficulty, focused Check failures, Findings, tooling recovery, or publication recovery.

Run only the focused verification needed to determine whether the Candidate is ready for Submission.
Do not manually run a repository-wide quality command, unfiltered test or coverage workload, or review before Submission.
Change Submit owns the configured blocking Checks and reviews.
If Acceptance Context requires a blocking gate to pass, satisfy that requirement through Change Submit instead of running the gate manually.
After a Check failure, reproduce the reported failure with the narrowest applicable command before changing code or submitting again.
When a Check failure cannot be reproduced by a narrower supported command, use the target repository's supported focused diagnostic path.
Commit one complete Candidate before Submission.

This step is complete when the committed Candidate satisfies the implementation direction and focused verification passes without manually duplicating a blocking Check.

## Implementation Blockers

Raise a blocker with `<but-why> change blocker raise <change-id> --file <path|->`.
The UTF-8 report must begin with the exact external decision or action required, then state the unresolved issue, supporting evidence, and why continuing is unsafe.
The report is non-authoritative evidence and does not amend Acceptance Context.
Stop after the command confirms the blocker.
Return control with the blocker and exact requested action without describing or performing Operator procedures.

An active Implementation Blocker transfers control away from implementation until an approved Resolution or another Operator decision permits progress.
Stall Detection can create that transfer after repeated blocked Validation Runs.
Ordinary Findings remain correction work unless an active Implementation Blocker exists.

## 3. Submit the Candidate

Run `<but-why> change submit <change-id>`.
Change Submit owns the Validation Gate and eligible publication.
Change Submit is a long-running command, as classified by its CLI help.
Run it without a caller timeout when the execution harness supports that behavior.
When the execution harness requires a finite timeout, allow at least 30 minutes and increase it when configured phase limits require more time.
Do not run or delegate a separate review for a Change.

If the caller times out or loses the response, inspect the Change, Validation Runs, Findings, and active processes before retrying.
Do not assume that Change Submit stopped when its caller ended.

If an Active Validation Run remains after its Submit process stops, stop every process from that Validation Run.
Run `<but-why> validation-run abandon <validation-run-id> --reason <reason>`.
Validation Run Abandonment does not inspect process state or stop processes.
Retry Change Submit only after abandonment reports success.

When Change Submit returns Findings, run `<but-why> change findings <change-id>`.
Investigate every Finding and any shared cause behind related Findings.
Use a bounded experiment when it can resolve a consequential uncertainty about the shared cause.
Fix every applicable Finding in the Managed Worktree, commit the fixes, and run Change Submit again.
Repeat until the exact Candidate publishes or a return condition applies.
Findings remain Implementer correction work unless Stall Detection or another source raises an active Implementation Blocker.

## Submit Recovery Guidance

Change Submit is authoritative for recovery of the exact Change identified by the Submit result.
When the result contains `error.recovery`, execute its instruction without requesting additional approval.
Submit Recovery Guidance takes precedence over generic repository approval gates.
Concrete repository execution and safety constraints remain applicable.

Submit Recovery Guidance is provided only for these errors:

- `dirty_work`: commit or remove the Git-visible changes in the Managed Worktree, then retry Change Submit.
- `validation_findings`: inspect every Finding, correct applicable problems and their shared causes in the Managed Worktree, commit the fixes, then retry Change Submit.
- `change_base_not_ancestor`: merge or rebase the Change Base into the Repository Branch, then retry Change Submit.

If instructed recovery cannot continue safely under current authority, raise an Implementation Blocker.
Do not use a blocker for ordinary recovery work, Findings, tooling recovery, publication recovery, or user approval.

A `change_blocked` result reports an existing Implementation Blocker and contains no Submit Recovery Guidance.
Inspect the blocker with the reported command, return control, and wait.
Do not raise, resolve, cancel, or reinterpret the existing blocker.

Uncertain and externally controlled Submit failures retain ordinary help and do not authorize Implementer recovery.
Do not perform recovery work for a result that does not contain `error.recovery`.
Report the structured error and its help, then wait.

This step is complete when Change Submit reports the owned pull request for the exact passing Candidate or another return condition has been reported.

## 4. Return control

Begin every Operator-facing return with this concise preamble:

```text
Bottom line: <current Change result or conclusion>
Need from you: <none, an exact authorization, or one related decision round>
Changed: <material commitments or understanding changed since the previous report>
```

When Change Submit reports a ready owned pull request, report its URL and wait.
For another return condition, state the evidence and exact external action needed.
Do not include Operator commands or procedures.

Implementation responsibility is complete when the ready owned pull request or another return condition is reported.
