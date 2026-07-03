# Create Runs from submit preflight

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Implement the preflight part of `by submit <task-id>` without running validation yet.

This should prove Task state rules, branch safety, GitHub target detection, branch binding, and commit-bound Run creation.

## Design decisions

Preflight rejections are not submissions and do not create Runs.
A successful preflight creates the Run and moves the Task to `validating`, even though later validation phases are not implemented in this issue.
Expected user-fixable refusals are preflight rejections.
Unexpected failures from Git, GitHub, or local state persistence are tooling errors.
A GitHub PR target requires identifying the GitHub repository, identifying the base branch, and making an authenticated read request for that repository.
For issue 009, a protected branch is the detected PR base branch or one of `main`, `master`, `develop`, or `trunk`.
Issue 009 does not need to call GitHub branch protection APIs.
On first submit, But Why? checks local task state and rejects if another Task is already bound to the current branch.
Branch ownership is enforced inside submit preflight; no separate branch command is required.
A Task can have only one active Run at a time.
Submitting the same commit again may create a new Run only after the previous Run is terminal.
Issue 009 only needs `active` and `error` Run statuses.
A successful preflight creates an `active` Run.
A tooling error after Run creation marks that Run `error`.
The final successful preflight mutation is one local transaction: verify no active Run for the Task, bind the Task to the branch if unbound, create the next `active` Run, and set the Task state to `validating`.
If any local write fails, rollback all local changes when possible.
Preflight rejections use stable structured error codes: `TASK_NOT_FOUND`, `TASK_STATE_NOT_SUBMITTABLE`, `CURRENT_BRANCH_REQUIRED`, `WORKTREE_NOT_CLEAN`, `PROTECTED_BRANCH`, `PR_TARGET_NOT_FOUND`, `BRANCH_ALREADY_BOUND`, `TASK_BRANCH_MISMATCH`, and `TASK_HAS_ACTIVE_RUN`.
A missing Task fails before Git checks.
A detached `HEAD` fails before Run creation with `CURRENT_BRANCH_REQUIRED`.
A clean working tree means no staged, unstaged, or untracked files.
Ignored files do not matter.
Read-only preflight checks run before local state mutation.
For GitHub PR target detection, prefer the current branch's upstream remote if it is GitHub, otherwise use `origin` if it is GitHub.
If the GitHub remote is ambiguous, fail with `PR_TARGET_NOT_FOUND`.
For base branch detection, use the current branch's upstream PR base when available, otherwise use the GitHub repository default branch.
If the base branch cannot be determined, fail with `PR_TARGET_NOT_FOUND`.
If the current branch equals the detected base branch, fail with `PROTECTED_BRANCH` even if the branch name is not in the fixed protected branch list.
Run IDs are task-scoped monotonic numbers and are never reused after failed or errored Runs.
For issue 009, `active` means non-terminal and `error` is terminal.
A tooling error before Run creation leaves the Task unchanged and creates no Run.
A tooling error after Run creation marks that Run `error` and restores the Task to its previous state when possible.
If Run creation or Task state update fails after branch binding, rollback the branch binding.
Successful stdout includes structured task id, run id, branch, commit SHA, Task state `validating`, and GitHub PR target data.
Preflight rejection stdout includes a structured error code, message, and actionable hint, with no Run ID.

## Acceptance criteria

- [ ] `by submit <task-id>` is allowed from `implementing` and `needs_input`.
- [ ] Submitting from `todo`, `validating`, `ready`, or `done` fails with a structured error.
- [ ] Submit requires a clean working tree.
- [ ] Submit requires a non-protected current branch.
- [ ] Submit detects a GitHub PR target and fails if it cannot.
- [ ] First submit binds the Task to the current branch.
- [ ] Later submits require the same branch.
- [ ] Submit captures the current commit SHA.
- [ ] Submit creates a task-scoped Run ID such as `BY-1.1`.
- [ ] A tooling error leaves the Task in its previous state and marks the Run as error if a Run was created.

## Blocked by

- 003-implement-repo-initialization.md
- 008-start-tasks.md
