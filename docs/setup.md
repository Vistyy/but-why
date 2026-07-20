# Internal Setup

Follow [`docs/public/setup.md`](public/setup.md) to install the CLI and configure an Agent Profile.
Use `by ...` in target repositories.
Use `just by ...` only when developing But Why? from this source checkout.

## Initialize a repository

From the target repository root, run:

```bash
by init --task-prefix BY
```

The command creates tracked Repo Config at `.but-why/config.json` and `.but-why/reviewers/`.
It stores shared SQLite state and Artifacts at `<git-common-dir>/but-why/`.

## Change workflow

1. Create and approve a Task when the work needs durable intent and dependencies.

   ```bash
   by task create --title "Fix login redirect" --description-file task.md
   by task approve BY-1
   ```

2. Start a Change.

   ```bash
   by change start --task BY-1
   ```

   Omit `--task` for taskless work.

3. Implement and commit in the returned Managed Worktree.

4. Submit the Change.

   ```bash
   by change submit <change-id>
   ```

   But Why validates the selected Candidate and publishes an eligible Change.
   A taskless Change remains open when it has no changed Candidate.

5. Reconcile an owned pull request after it merges.

   ```bash
   by change reconcile [<change-id>]
   ```

   Reconciliation closes the Change and completes its linked Task when applicable.
