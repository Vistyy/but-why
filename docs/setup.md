# Internal Setup

> This document describes the currently implemented workflow.
> Task 123 will replace it with the Change-centered public workflow.

Follow [`docs/public/setup.md`](public/setup.md) to install the CLI and configure an Agent Profile.
Use `by ...` in target repositories.
Use `just by ...` only when developing But Why? from this source checkout.

## Initialize a repository

From the target repository root, run:

```bash
by init --task-prefix BY
```

Replace `BY` with the required Task ID prefix.
For example, the prefix creates IDs such as `BY-1` and `BY-2`.

The command creates these tracked worktree paths:

```text
.but-why/config.json
.but-why/reviewers/
```

It stores SQLite state and Artifacts in the shared Git common directory:

```text
<git-common-dir>/but-why/
```

Config and reviewer instructions are not ignored by default.
Commit them when the repository must share the same policy.
See [`docs/config.md`](config.md) for configuration details.

## GitHub requirement

The current workflow requires a GitHub PR target.
But Why detects the base branch, publish remote, GitHub repository, and GitHub authentication at runtime.
If detection fails, `by submit <task-id>` rejects the Submission during preflight.

## Current workflow

1. Create a Task.

   ```bash
   by task create --title "Fix login redirect" --description-file task.md
   ```

2. Approve the Task intent.

   ```bash
   by task approve BY-1
   ```

3. Start its prepared Change.

   ```bash
   by change start --task BY-1
   ```

   The command returns the Managed Worktree.

4. Implement and commit the Change in that Managed Worktree.

5. Submit the Task.

   ```bash
   by submit BY-1
   ```

   A Finding moves the Task to `needs_input`.
   Fix the Finding and submit the Task again.
   A clean PR moves the Task to `ready`.

6. Ask a human to merge the PR.

7. Reconcile the merged PR.

   ```bash
   by reconcile
   ```

   Reconciliation moves the Task to `done`.

## Current daemon

Run the repository-local reconciliation daemon:

```bash
by daemon
```

The daemon polls GitHub for PRs created by But Why in the current repository.
It does not process new Submissions.
