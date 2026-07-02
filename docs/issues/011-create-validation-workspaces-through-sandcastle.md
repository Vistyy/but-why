# Create validation workspaces through Sandcastle

## Status

Not done.

## Parent

`docs/prd.md`

## What to build

Use the proven Sandcastle path to create isolated validation workspaces for Runs.

Validation should operate on a temp validation ref at the submitted commit and should not mutate the user's checkout.

But Why should not require a tracked `.sandcastle/` directory for this.

Normal validation config stays under `.but-why`.

## Acceptance criteria

- [ ] Submit creates a temp validation ref for the exact submitted commit SHA.
- [ ] The temp validation ref does not move after creation.
- [ ] The temp validation ref is owned and named by Run id, not by task id or branch name.
- [ ] If the temp validation ref already exists at the submitted SHA, setup may reuse it.
- [ ] If the temp validation ref already exists at any other SHA, setup fails with a tooling error.
- [ ] Sandcastle creates a validation worktree from the temp ref.
- [ ] Repo config may allowlist repo-relative files to copy into the validation worktree.
- [ ] Allowlisted files are copied through Sandcastle workspace setup before validation runs.
- [ ] Untracked files are not copied automatically.
- [ ] Missing allowlisted files fail setup with a tooling error.
- [ ] If the validation worktree already exists for the same Run and submitted SHA, setup may reuse or safely replace it.
- [ ] If the validation worktree already exists for a different Run or SHA, setup fails with a tooling error.
- [ ] The validation worktree contains the submitted code.
- [ ] The user's original checkout is not mutated.
- [ ] Sandcastle runtime paths are ignored without requiring a tracked `.sandcastle/` directory.
- [ ] Ignored Sandcastle runtime paths include `.sandcastle/worktrees/`, `.sandcastle/logs/`, `.sandcastle/patches/`, and `.sandcastle/.env`.
- [ ] Successful workspace setup is recorded as Run-scoped setup, not as phase or round data.
- [ ] Cleanup removes the validation worktree and temp ref on success.
- [ ] Workspace setup failure still attempts cleanup of the validation worktree and temp ref.
- [ ] Tooling errors are recorded on the Run with at least the Sandcastle operation name, temp ref name, submitted SHA, worktree path if known, error message, and cleanup result.
- [ ] Tooling errors do not create Findings or send the Task to `needs_input`.

## Blocked by

- 010-deepen-task-submission-and-cli-seams.md
