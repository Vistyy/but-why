# Inspect Validation Runs and latest Task Findings

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add read commands for validation results.

Agents should be able to inspect latest Task Findings without knowing the latest Validation Run ID, and inspect full Validation Run details when debugging.

## Acceptance criteria

- [ ] `by task findings <task-id>` shows latest Findings for the Task.
- [ ] `by task findings <task-id>` does not require a Validation Run ID.
- [ ] `by validation-run show <validation-run-id>` shows full Validation Run details.
- [ ] Validation Run details include phases, rounds, Findings, artifact refs, status, branch, and commit.
- [ ] Run details distinguish Findings from typed tooling errors.
- [ ] Finding source is shown as `phase/producer`.
- [ ] Finding IDs use the Validation Run-scoped form such as `BY-1.1-F1`.
- [ ] Artifact refs use the agreed artifact ref format.

## Blocked by

- 012-run-check-commands-and-create-check-findings.md
