# Add validation prepare phase

## Status

Done.

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

- [x] Repo config supports optional `validation.prepare.command`.
- [x] Repo config supports optional `validation.prepare.timeoutSeconds`.
- [x] Present `validation.prepare` requires `command`.
- [x] Prepare commands are non-empty shell command strings.
- [x] Prepare supports one command string in v1.
- [x] Prepare does not support argv arrays or multiple command entries in v1.
- [x] Missing `validation.prepare` records the prepare phase as skipped and runs later validation phases directly.
- [x] Prepare runs after Validation Workspace creation and before later validation phases.
- [x] Prepare runs inside the Validation Workspace.
- [x] Prepare runs from the repo root inside the Validation Workspace.
- [x] Prepare runs through the configured validation sandbox mode.
- [x] Prepare has no separate network policy; network access is controlled by the validation sandbox mode.
- [x] Prepare may modify files inside the Validation Workspace.
- [x] Later validation phases run against the workspace after prepare mutations.
- [x] Prepare mutations are not committed back to the task branch.
- [x] Prepare without `timeoutSeconds` defaults to the same timeout default as checks.
- [x] `validation.prepare.timeoutSeconds` must be a positive integer.
- [x] A non-zero prepare exit code creates a blocking Finding.
- [x] A prepare timeout creates a blocking Finding.
- [x] Prepare command execution tooling failures are recorded as Validation Tooling Failures, not Findings.
- [x] Later validation phases run only when prepare passes.
- [x] Later validation phases are skipped when prepare fails or times out.
- [x] A failed or timed-out prepare ends the Validation Gate early as a prepare-specific gate rule.
- [x] Prepare artifacts use refs shaped like `artifact:<validation-run-id>/prepare/prepare/<filename>`.
- [x] Prepare records one prepare round with producer id `prepare`.
- [x] Prepare captures `stdout.txt`, `stderr.txt`, `exit-code.json`, and `logs.txt` artifacts for passed, failed, and timed-out prepare rounds.
- [x] Prepare artifacts are saved outside the Validation Workspace before workspace cleanup.
- [x] Prepare does not preserve workspace file changes as artifacts.
- [x] Prepare failure Findings use title `Prepare failed`.
- [x] Prepare timeout Findings use title `Prepare timed out`.
- [x] Prepare Findings include stdout, stderr, exit-code, and logs artifact refs.
- [x] Prepare Findings use empty `files`.
- [x] Prepare Findings do not include a `severity` field under the command-produced Finding contract.
- [x] A failed prepare moves the Task to `needs_input`.
- [x] Validation Run records include the prepare phase status.
- [x] Validation Run records include prepare status even when prepare is skipped.
- [x] Skipped phase records distinguish prepare skipped because it was not configured from later phases skipped because prepare failed.
- [x] The canonical v1 phase list is updated to `preflight`, `prepare`, `checks`, `intent_review`, `quality_review`, `publish_pr`, and `watch_pr`.
- [x] Retrying validation for the same commit creates a fresh Validation Run and runs configured prepare again.
- [x] `by validation-run show` can show prepare phase status and artifact refs once issue 013 exists.
- [x] `docs/config.md` documents `validation.prepare`.
- [x] Tests cover passing prepare, failing prepare, prepare timeout, skipped later validation phases after prepare failure, and missing prepare.

## Blocked by

- `docs/issues/012-run-check-commands-and-create-check-findings.md`
- `docs/issues/045-make-finding-severity-optional-by-producer-contract.md`
