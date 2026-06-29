# Inspect Runs and latest Task Findings

## Parent

`docs/prd.md`

## What to build

Add read commands for validation results.

Agents should be able to inspect latest Task Findings without knowing the latest Run ID, and inspect full Run details when debugging.

## Acceptance criteria

- [ ] `by task findings <task-id>` shows latest Findings for the Task.
- [ ] `by task findings <task-id>` does not require a Run ID.
- [ ] `by run show <run-id>` shows full Run details.
- [ ] Run details include phases, rounds, Findings, artifact refs, status, branch, and commit.
- [ ] Finding source is shown as `phase/producer`.
- [ ] Finding IDs use the run-scoped form such as `BY-1.1-F1`.
- [ ] Artifact refs use the agreed artifact ref format.

## Blocked by

- 010-run-check-commands-and-create-check-findings.md
