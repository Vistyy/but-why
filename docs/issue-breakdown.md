# Proposed Issue Breakdown

This breakdown turns the PRD into smaller tracer-bullet implementation issues.

It is not the final local issue draft set until approved.

## 1. Prove Sandcastle can support v1 execution

**Blocked by**: None.

**User stories covered**: 10, 11, 16, 27, 32, 33.

Prove the execution dependency before building product code.

This includes validation worktrees from temp refs, command checks, Pi reviewer agents, structured output retry, logs, token usage, and cleanup.

## 2. Create the TypeScript CLI foundation

**Blocked by**: Issue 1.

**User stories covered**: 28, 29.

Create the project foundation with the `by` executable, strict TypeScript, Effect, Effect Schema, SQLite access, linting, typechecking, tests, and TOON-style CLI output conventions.

This slice should make `by` runnable and verifiable, even if it only prints an empty dashboard.

## 3. Implement repo initialization

**Blocked by**: Issue 2.

**User stories covered**: 28, 29, 30, 31.

Implement `by init --task-prefix <prefix>` and repo-local configuration/state creation.

This slice creates `.but-why/config.json`, `.but-why/state.sqlite`, `.but-why/reviewers/`, and `.gitignore` entries for local state.

## 4. Create and list Tasks

**Blocked by**: Issue 3.

**User stories covered**: 1, 2, 28, 29.

Implement `by task create`, `by task list`, and the default `by` dashboard for task visibility.

This slice proves that Tasks can be created in `todo`, persisted, listed, and shown as actionable dashboard data.

## 5. Show Task details and Task Context

**Blocked by**: Issue 4.

**User stories covered**: 4, 20, 28, 29.

Implement `by task show <task-id>` and `by task context <task-id>`.

This slice separates compact task metadata from full Task Context.

## 6. Add Task comments

**Blocked by**: Issue 5.

**User stories covered**: 4, 21, 28, 29.

Implement `by task comment <task-id> --file <file>`.

This slice makes comments append-only Task Context and proves comments do not change Task state.

## 7. Start Tasks

**Blocked by**: Issue 4.

**User stories covered**: 3, 28, 29.

Implement `by task start <task-id>`.

This slice moves Tasks from `todo` to `implementing`, treats already implementing as a no-op, and rejects invalid states.

## 8. Create Runs from submit preflight

**Blocked by**: Issues 3 and 7.

**User stories covered**: 5, 6, 7, 8, 9, 29.

Implement the preflight part of `by submit <task-id>` without running validation yet.

This slice enforces allowed states, clean working tree, non-protected branch, GitHub target detection, branch binding, commit capture, and task-scoped Run creation.

## 9. Create validation workspaces through Sandcastle

**Blocked by**: Issue 8.

**User stories covered**: 10, 32.

Use the proven Sandcastle path to create a temp validation ref and isolated validation worktree for a Run.

This slice proves the real submit path can validate a commit without mutating the user's checkout.

## 10. Run check commands and create check Findings

**Blocked by**: Issue 9.

**User stories covered**: 11, 12, 13, 17, 18.

Run configured check commands through Sandcastle.

This slice records phase and round history, stores logs as artifacts, and creates blocking Findings when a check fails.

## 11. Inspect Runs and latest Task Findings

**Blocked by**: Issue 10.

**User stories covered**: 19, 28, 29.

Implement `by task findings <task-id>` and `by run show <run-id>` for check-based Runs.

This slice gives agents direct access to latest Findings without requiring a Run ID.

## 12. Add intent reviewer agent

**Blocked by**: Issue 11.

**User stories covered**: 14, 16, 17, 18, 27, 31.

Run the configured intent reviewer through Sandcastle after checks pass.

This slice validates structured JSON, stores reviewer Findings, stores token usage, and moves the Task to `needs_input` when intent review finds anything.

## 13. Add configurable quality reviewers

**Blocked by**: Issue 12.

**User stories covered**: 15, 16, 17, 18, 27, 31.

Run configured quality reviewers after intent review passes.

This slice supports sequential or parallel reviewer groups according to repo config and stores producer/model token usage.

## 14. Publish clean Runs to GitHub PRs

**Blocked by**: Issue 13.

**User stories covered**: 22, 24.

After a Run has no Findings, push the task branch and open or update a GitHub PR.

This slice records PR state but does not yet watch CI to readiness.

## 15. Watch PRs during submit until ready or blocked

**Blocked by**: Issue 14.

**User stories covered**: 23, 24.

Extend `by submit` to watch the PR until it is ready, blocked, errored, or timed out.

This slice creates blocking Findings for CI failure, merge conflict, requested changes, or timeout.

## 16. Track token usage summaries

**Blocked by**: Issues 12 and 13.

**User stories covered**: 27.

Add run-level and task-level token summaries split by producer, model, input, cached input, output, and total.

This slice makes token data visible in `by run show` and `by task show`.

## 17. Add repo-local PR reconciliation

**Blocked by**: Issue 15.

**User stories covered**: 25, 26.

Implement `by reconcile` for one-shot GitHub PR state reconciliation.

This slice moves ready Tasks to done when PRs are merged and ready Tasks to needs input when PRs become unready.

## 18. Add repo-local daemon

**Blocked by**: Issue 17.

**User stories covered**: 25, 26.

Implement `by daemon` as a polling loop around the same reconciliation logic.

This slice does not process new submissions.

## 19. Add reviewer eval fixtures

**Blocked by**: Issues 12 and 13.

**User stories covered**: 14, 15, 16, 17, 18.

Add golden fixtures for Task Context, diffs, reviewer behavior, and expected Findings.

This slice protects reviewer prompts, schema contracts, and finding behavior from drift.

## Proposed dependency graph

```text
1 Sandcastle spike
  -> 2 CLI foundation
    -> 3 init
      -> 4 create/list Tasks
        -> 5 task show/context
          -> 6 comments
        -> 7 start Tasks
          -> 8 submit preflight and Run creation
            -> 9 validation workspace
              -> 10 checks and check Findings
                -> 11 inspection commands
                  -> 12 intent reviewer
                    -> 13 quality reviewers
                      -> 14 publish PR
                        -> 15 watch PR
                          -> 17 reconcile
                            -> 18 daemon
                    -> 16 token summaries
                    -> 19 reviewer evals
```

## Questions for approval

- Does this granularity feel closer?
- Should token summaries be merged into reviewer implementation instead of separate issue 16?
- Should reviewer evals move earlier, before quality reviewers?
- Are any slices still too broad?
