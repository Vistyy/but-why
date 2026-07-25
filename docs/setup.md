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
Change Start creates each new Managed Worktree at `<main-checkout-parent>/<main-checkout-name>-worktrees/but-why/<change-slug>`.
But Why resolves this location from Git's canonical main checkout, including when Change Start runs from a linked worktree.
But Why does not support bare repositories, repository relocation, or Git worktree repair.

## Change workflow

SQLite Tasks are the source of truth for new active work.
Use `by task` instead of creating new files in `docs/issues/`.
Existing Markdown issues remain historical implementation records.

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
   Change Start fetches the detected publication remote's default branch.
   Pass `--base <branch>` to fetch and use a named branch on that remote.
   Local branches cannot supply a Change Base.

3. Implement and commit in the returned Managed Worktree.

4. Submit the Change.

   ```bash
   by change submit <change-id>
   ```

   But Why reconciles an existing owned pull request before a new Submission.
   But Why fetches the recorded remote Change Base before Candidate capture.
   Merge or rebase the Change Base first when the Repository Branch does not contain the fetched commit.
   But Why validates the selected Candidate and publishes an eligible Change.
   A taskless Change remains open when its tracked tree matches the fetched Change Base.

5. Reconcile an owned pull request after it merges.

   ```bash
   by change reconcile [<change-id>]
   ```

   Reconciliation closes the Change and completes its linked Task when applicable.

## pre-release Candidate state repair

Do not run this procedure before the simplified Candidate schema is present on the integration branch.
Before repair, stop workflows that can write Shared Repository State.
Choose a backup path that does not exist.
Run the conditional repair against the shared development database:

```bash
just repair-pre-release-candidate-state <git-common-dir>/but-why/state.sqlite <backup-path>
```

The command repairs only the retired pre-release Candidate schema.
The command exits successfully without mutation when the Candidate schema is already current.
Before mutation, the command rejects Candidate identity collisions and creates the requested backup.
The transaction preserves Candidate IDs and maps the freshly fetched Change Base commit to `changeBaseSha`.
The command verifies every table row count, foreign keys, and SQLite integrity before commit and after commit.
Keep the backup until the blocked workflow resumes and the repaired state has been inspected.
