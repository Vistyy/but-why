# Add validation prepare phase

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add an explicit validation prepare phase that runs after the Validation Workspace is created and before later validation phases run.

Prepare is where a repo installs, restores, syncs, or fetches dependencies needed by later validation phases.

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
- [ ] Present `validation.prepare` requires `command`.
- [ ] Prepare commands are non-empty shell command strings.
- [ ] Prepare supports one command string in v1.
- [ ] Prepare does not support argv arrays or multiple command entries in v1.
- [ ] Missing `validation.prepare` records the prepare phase as skipped and runs later validation phases directly.
- [ ] Prepare runs after Validation Workspace creation and before later validation phases.
- [ ] Prepare runs inside the Validation Workspace.
- [ ] Prepare runs from the repo root inside the Validation Workspace.
- [ ] Prepare runs through the configured validation sandbox mode.
- [ ] Prepare has no separate network policy; network access is controlled by the validation sandbox mode.
- [ ] Prepare may modify files inside the Validation Workspace.
- [ ] Later validation phases run against the workspace after prepare mutations.
- [ ] Prepare mutations are not committed back to the task branch.
- [ ] Prepare without `timeoutSeconds` defaults to the same timeout default as checks.
- [ ] `validation.prepare.timeoutSeconds` must be a positive integer.
- [ ] A non-zero prepare exit code creates a blocking Finding.
- [ ] A prepare timeout creates a blocking Finding.
- [ ] Prepare command execution tooling failures are recorded as Validation Tooling Failures, not Findings.
- [ ] Later validation phases run only when prepare passes.
- [ ] Later validation phases are skipped when prepare fails or times out.
- [ ] A failed or timed-out prepare ends the Validation Gate early as a prepare-specific gate rule.
- [ ] Prepare artifacts use refs shaped like `artifact:<validation-run-id>/prepare/prepare/<filename>`.
- [ ] Prepare records one prepare round with producer id `prepare`.
- [ ] Prepare captures `stdout.txt`, `stderr.txt`, `exit-code.json`, and `logs.txt` artifacts for passed, failed, and timed-out prepare rounds.
- [ ] Prepare artifacts are saved outside the Validation Workspace before workspace cleanup.
- [ ] Prepare does not preserve workspace file changes as artifacts.
- [ ] Prepare failure Findings use title `Prepare failed`.
- [ ] Prepare timeout Findings use title `Prepare timed out`.
- [ ] Prepare Findings include stdout, stderr, exit-code, and logs artifact refs.
- [ ] Prepare Findings use empty `files`.
- [ ] Prepare Findings do not include a `severity` field under the command-produced Finding contract.
- [ ] A failed prepare moves the Task to `needs_input`.
- [ ] Validation Run records include the prepare phase status.
- [ ] Validation Run records include prepare status even when prepare is skipped.
- [ ] Skipped phase records distinguish prepare skipped because it was not configured from later phases skipped because prepare failed.
- [ ] The canonical v1 phase list is updated to `preflight`, `prepare`, `checks`, `intent_review`, `quality_review`, `publish_pr`, and `watch_pr`.
- [ ] Retrying validation for the same commit creates a fresh Validation Run and runs configured prepare again.
- [ ] `by validation-run show` can show prepare phase status and artifact refs once issue 013 exists.
- [ ] `docs/config.md` documents `validation.prepare`.
- [ ] Tests cover passing prepare, failing prepare, prepare timeout, skipped later validation phases after prepare failure, and missing prepare.

## Blocked by

- `docs/issues/012-run-check-commands-and-create-check-findings.md`
- `docs/issues/045-make-finding-severity-optional-by-producer-contract.md`
