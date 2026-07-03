# Create validation workspaces through Sandcastle

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Use the proven Sandcastle path to create isolated validation workspaces for Runs.

Validation should operate on a temp validation ref at the submitted commit and should not mutate the user's checkout.

But Why should not require a tracked `.sandcastle/` directory for this.

Normal validation config stays under `.but-why`.

## Acceptance criteria

- [x] Submit creates a temp validation ref for the exact submitted commit SHA.
- [x] The temp validation ref does not move after creation.
- [x] The temp validation ref is owned and named by Run id, not by task id or branch name.
- [x] If the temp validation ref already exists at the submitted SHA, setup may reuse it.
- [x] If the temp validation ref already exists at any other SHA, setup fails with a tooling error.
- [x] Sandcastle creates a validation worktree from the temp ref.
- [x] Repo config may allowlist repo-relative files to copy into the validation worktree.
- [x] Allowlisted files are copied through Sandcastle workspace setup before validation runs.
- [x] Untracked files are not copied automatically.
- [x] Missing allowlisted files fail setup with a tooling error.
- [x] If the validation worktree already exists for the same Run and submitted SHA, setup may reuse or safely replace it.
- [x] If the validation worktree already exists for a different Run or SHA, setup fails with a tooling error.
- [x] The validation worktree contains the submitted code.
- [x] The user's original checkout is not mutated.
- [x] Sandcastle runtime paths are ignored without requiring a tracked `.sandcastle/` directory.
- [x] Ignored Sandcastle runtime paths include `.sandcastle/worktrees/`, `.sandcastle/logs/`, `.sandcastle/patches/`, and `.sandcastle/.env`.
- [x] Successful workspace setup is recorded as Run-scoped setup, not as phase or round data.
- [x] Cleanup removes the validation worktree and temp ref on success.
- [x] Workspace setup failure still attempts cleanup of the validation worktree and temp ref.
- [x] Tooling errors are recorded on the Run with at least the Sandcastle operation name, temp ref name, submitted SHA, worktree path if known, error message, and cleanup result.
- [x] Tooling errors do not create Findings or send the Task to `needs_input`.

## Blocked by

- 010-deepen-task-submission-and-cli-seams.md
