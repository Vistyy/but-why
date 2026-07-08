# Run check commands and create check Findings

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Run configured check commands through Sandcastle as the first real validation phase.

Failed checks should become blocking Findings so all validation blockers are visible through one path.

## Acceptance criteria

- [ ] Repo config must define at least one check command.
- [ ] V1 check commands are shell command strings.
- [ ] Argv-array check commands are deferred until Sandcastle supports argv-native execution.
- [ ] Missing or empty `checks` is rejected before Validation Run creation as a Submit Rejection Error.
- [ ] Repo config can choose validation execution sandboxing with `validation.sandbox.mode`.
- [ ] `validation.sandbox.mode` supports But Why validation sandboxing modes such as `none`, `docker`, or `podman`.
- [ ] Missing `validation.sandbox.mode` defaults to `none`.
- [ ] The sandbox mode is repo-level validation execution policy, not per-check config.
- [ ] `none` means no Docker or Podman sandbox, but checks still run inside the Validation Workspace.
- [ ] Checks run inside the Validation Workspace, not the user's checkout.
- [ ] Checks run from the repo root inside the Validation Workspace.
- [ ] Checks run through the configured validation sandboxing mode, not a hard-coded `noSandbox()` provider.
- [ ] Invalid sandboxing mode in repo config is rejected before Validation Run creation as a Submit Rejection Error.
- [ ] Requested sandboxing that is unavailable at runtime is recorded as a Validation Tooling Failure.
- [ ] Check phase orchestration uses `Effect.gen` or equivalent Effect workflow composition.
- [ ] Checks run sequentially.
- [ ] Validation stops on the first failed check.
- [ ] Each check can set `timeoutSeconds`.
- [ ] `timeoutSeconds` must be a positive integer.
- [ ] Checks without `timeoutSeconds` default to `1200` seconds.
- [ ] Check timeouts create Findings, not Validation Tooling Failures.
- [ ] Validation stops immediately after a check timeout.
- [ ] `checks[].id` is the Producer id for the check round.
- [ ] Check ids are valid for artifact refs.
- [ ] Check ids contain only lowercase letters, numbers, `-`, and `_`.
- [ ] Check ids start with a lowercase letter or number.
- [ ] Duplicate check ids are rejected before Validation Run creation as a Submit Rejection Error.
- [ ] Check artifacts use refs shaped like `artifact:<validation-run-id>/checks/<check-id>/<filename>`.
- [ ] Each check round captures `stdout.txt`, `stderr.txt`, `exit-code.json`, and `logs.txt` artifacts.
- [ ] Check artifacts are saved outside the Validation Workspace before workspace cleanup.
- [ ] Check artifact capture uses the command result returned by Sandcastle, not files left in the Validation Workspace.
- [ ] A failed check exit code creates a blocking Finding from the `checks` phase because a Finding is any validation blocker about the submission, including failed configured checks.
- [ ] Failed check Findings do not include a `severity` field.
- [ ] Failed check Finding evidence includes the command and exit code, not stdout or stderr excerpts.
- [ ] Failed check Finding `files` is empty.
- [ ] Timeout Findings use `title: Check timed out: <check id>`, evidence with command and `timeoutSeconds`, empty `files`, and no `severity` field.
- [ ] Failed and timed-out check Findings include stdout, stderr, exit-code, and logs artifact refs.
- [ ] Command execution tooling failures use typed validation errors and are recorded as Validation Tooling Failures, not Findings.
- [ ] Command execution tooling failures are limited to cases where But Why or Sandcastle cannot start, observe, capture, or record the command result.
- [ ] Non-zero exit codes and timeouts are check outcomes and create Findings.
- [ ] Runtime sandbox, command execution, and workspace failures are recorded as Validation Tooling Failures, not Findings.
- [ ] Every executed check records a round and artifacts, whether it passes, fails, or times out.
- [ ] Checks skipped after an earlier failure or timeout do not record rounds or artifacts.
- [ ] Check commands may modify the Validation Workspace, but those changes never modify the submitted branch.
- [ ] Any Finding moves the Task to `needs_input`.
- [ ] A clean check phase can pass without changing the submitted branch.
- [ ] Validation Run, phase, and round records are durable.

## Blocked by

- `docs/issues/027-represent-validation-run-separately-from-run.md`
- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
- `docs/issues/038-manage-validation-workspace-lifecycle-with-effect-scope.md`
