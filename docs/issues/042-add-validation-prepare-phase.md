# Add validation prepare phase

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add an explicit validation prepare phase that runs after the Validation Workspace is created and before checks run.

Prepare is where a repo installs, restores, syncs, or fetches dependencies needed by checks.

The prepare command is repo policy in `.but-why/config.json`.
It is not hidden agent behavior.
Agents should configure it during setup based on the repo's normal tooling.

Example config shape:

```json
{
  "taskPrefix": "BY",
  "validation": {
    "prepare": {
      "command": "pnpm install --frozen-lockfile --prefer-offline"
    },
    "checks": [
      {
        "id": "quality",
        "command": "just quality"
      }
    ]
  }
}
```

## Acceptance criteria

- [ ] Repo config supports optional `validation.prepare.command`.
- [ ] Repo config supports optional `validation.prepare.timeoutSeconds`.
- [ ] Prepare commands are shell command strings.
- [ ] Missing `validation.prepare` keeps current behavior and runs checks directly.
- [ ] Prepare runs after Validation Workspace creation and before any check.
- [ ] Prepare runs inside the Validation Workspace.
- [ ] Prepare runs from the repo root inside the Validation Workspace.
- [ ] Prepare runs through the configured validation sandbox mode.
- [ ] Prepare without `timeoutSeconds` defaults to the same timeout default as checks.
- [ ] `validation.prepare.timeoutSeconds` must be a positive integer.
- [ ] A non-zero prepare exit code creates a blocking Finding.
- [ ] A prepare timeout creates a blocking Finding.
- [ ] Prepare command execution tooling failures are recorded as Validation Tooling Failures, not Findings.
- [ ] Checks run only when prepare passes.
- [ ] Checks are skipped when prepare fails or times out.
- [ ] Prepare artifacts use refs shaped like `artifact:<validation-run-id>/prepare/<filename>`.
- [ ] Prepare captures `stdout.txt`, `stderr.txt`, `exit-code.json`, and `logs.txt` artifacts.
- [ ] Prepare artifacts are saved outside the Validation Workspace before workspace cleanup.
- [ ] Prepare Findings include stdout, stderr, exit-code, and logs artifact refs.
- [ ] Prepare Findings use `severity: high`.
- [ ] A failed prepare moves the Task to `needs_input`.
- [ ] Validation Run records include the prepare phase status.
- [ ] `by validation-run show` can show prepare phase status and artifact refs once issue 013 exists.
- [ ] `docs/config.md` documents `validation.prepare`.
- [ ] Tests cover passing prepare, failing prepare, prepare timeout, skipped checks after prepare failure, and missing prepare.

## Blocked by

- `docs/issues/012-run-check-commands-and-create-check-findings.md`
