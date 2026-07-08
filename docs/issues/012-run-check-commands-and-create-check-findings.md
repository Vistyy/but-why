# Run check commands and create check Findings

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Run configured check commands through Sandcastle as the first real validation phase.

Failed checks should become blocking Findings so all validation blockers are visible through one path.

## Acceptance criteria

- [ ] Repo config can define one or more check commands.
- [ ] Repo config can choose whether validation execution uses sandboxing.
- [ ] Repo config can select the But Why validation sandboxing mode, such as no sandbox, Docker, or Podman.
- [ ] Checks run inside the Validation Workspace, not the user's checkout.
- [ ] Checks run through the configured validation sandboxing mode, not a hard-coded `noSandbox()` provider.
- [ ] Validation fails with a structured tooling error if the configured sandboxing mode is invalid or unavailable.
- [ ] Check phase orchestration uses `Effect.gen` or equivalent Effect workflow composition.
- [ ] Checks run sequentially.
- [ ] Validation stops on the first failed check.
- [ ] Check stdout, stderr, exit code, and logs are captured as artifacts.
- [ ] A failed check exit code creates a blocking Finding.
- [ ] Command execution tooling failures use typed validation errors and are recorded as Validation Tooling Failures, not Findings.
- [ ] Sandbox, config, and workspace failures are recorded as Validation Tooling Failures, not Findings.
- [ ] Any Finding moves the Task to `needs_input`.
- [ ] A clean check phase can pass without changing the submitted branch.
- [ ] Validation Run, phase, and round records are durable.

## Blocked by

- `docs/issues/027-represent-validation-run-separately-from-run.md`
- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
- `docs/issues/038-manage-validation-workspace-lifecycle-with-effect-scope.md`
