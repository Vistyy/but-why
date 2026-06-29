# Create validation workspaces through Sandcastle

## Parent

`docs/prd.md`

## What to build

Use the proven Sandcastle path to create isolated validation workspaces for Runs.

Validation should operate on a temp validation ref at the submitted commit and should not mutate the user's checkout.

## Acceptance criteria

- [ ] Submit creates a temp validation ref for the submitted commit.
- [ ] Sandcastle creates a validation worktree from the temp ref.
- [ ] The validation worktree contains the submitted code.
- [ ] The user's original checkout is not mutated.
- [ ] Successful workspace setup records phase and round data.
- [ ] Cleanup removes the validation worktree and temp ref on success.
- [ ] Tooling errors keep enough debug information to diagnose failure.

## Blocked by

- 008-create-runs-from-submit-preflight.md
