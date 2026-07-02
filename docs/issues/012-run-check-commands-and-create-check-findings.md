# Run check commands and create check Findings

## Status

Not done.

## Parent

`docs/prd.md`

## What to build

Run configured check commands through Sandcastle as the first real validation phase.

Failed checks should become blocking Findings so all validation blockers are visible through one path.

## Acceptance criteria

- [ ] Repo config can define one or more check commands.
- [ ] Repo config can choose whether validation execution uses sandboxing.
- [ ] Repo config can select the But Why validation sandboxing mode, such as no sandbox, Docker, or Podman.
- [ ] Checks run in the validation worktree.
- [ ] Checks run through the configured validation sandboxing mode, not a hard-coded `noSandbox()` provider.
- [ ] Validation fails with a structured tooling error if the configured sandboxing mode is invalid or unavailable.
- [ ] Checks run sequentially.
- [ ] Validation stops on the first failed check.
- [ ] Check stdout, stderr, exit code, and logs are captured as artifacts.
- [ ] A failed check creates a blocking Finding.
- [ ] Any Finding moves the Task to `needs_input`.
- [ ] A clean check phase can pass without changing the submitted branch.
- [ ] Run, phase, and round records are durable.

## Blocked by

- 011-create-validation-workspaces-through-sandcastle.md
