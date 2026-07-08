# Inspect Validation Runs and latest Task Findings

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add read commands for validation results.

Agents should be able to inspect latest Task Findings without knowing the latest Validation Run ID, list a Task's Validation Run History, and inspect full Validation Run details when debugging.

`by task findings <task-id>` shows Findings from the latest Validation Run by task validation number.
If the latest Validation Run has no Findings, the command shows no Findings rather than falling back to older Validation Runs.
Prior Findings remain inspectable through Validation Run History and `by validation-run show <validation-run-id>`.
`by task findings <task-id>` shows tooling failures only from the latest Validation Run.
Unknown Task IDs and unknown Validation Run IDs are command errors.
Known Tasks with no Validation Run History are successful empty reads.

## Output contracts

`by task findings <task-id>` returns `task`, `validationRun`, `findings`, `toolingFailures`, and `count`.

`by task validation-runs <task-id>` returns summaries only.
Each summary includes `id`, `taskValidationNumber`, `status`, `branch`, `commit`, `findingCount`, `toolingFailureCount`, `createdAt`, and `updatedAt`.

`by validation-run show <validation-run-id>` returns full details without artifact contents.
It includes artifact refs and artifact metadata.
Findings include their evidence artifact refs, and the top-level `artifacts` section provides the full artifact index.

## Acceptance criteria

- [x] `by task findings <task-id>` shows Findings from the latest Validation Run for the Task.
- [x] `by task findings <task-id>` does not require a Validation Run ID.
- [x] `by task findings <task-id>` does not fall back to older Validation Runs when the latest Validation Run has no Findings.
- [x] `by task findings <task-id>` succeeds with `findings: []` and `validationRun: null` when the Task has no Validation Runs.
- [x] `by task findings <task-id>` succeeds with `findings: []` and the latest Validation Run ID and status when the latest Validation Run has no Findings.
- [x] `by task findings <task-id>` succeeds with `findings: []` and typed tooling failures when the latest Validation Run has tooling failures but no Findings.
- [x] `by task findings <task-id>` includes tooling failures only from the latest Validation Run.
- [x] `by task findings <task-id>` returns `task`, `validationRun`, `findings`, `toolingFailures`, and `count`.
- [x] `by task validation-runs <task-id>` lists the Task's Validation Run History newest first by task validation number.
- [x] `by task validation-runs <task-id>` returns summaries with `id`, `taskValidationNumber`, `status`, `branch`, `commit`, `findingCount`, `toolingFailureCount`, `createdAt`, and `updatedAt`.
- [x] `by validation-run show <validation-run-id>` shows full Validation Run details for any Validation Run in the Task's Validation Run History.
- [x] Validation Run details are structured as top-level `validationRun`, `phases`, `rounds`, `findings`, `toolingFailures`, and `artifacts` sections.
- [x] Validation Run details include phases, rounds, Findings, artifact refs, status, branch, and commit.
- [x] Validation Run details include artifact refs and artifact metadata, not artifact contents.
- [x] Run details distinguish Findings from typed tooling errors.
- [x] Findings record `producer` as the stable slug-like validator name that created the Finding, unique within the phase.
- [x] Finding output includes `phase`, `producer`, and computed `source`.
- [x] Finding source is shown as `phase/producer`.
- [x] Finding `producer` is not derived from artifact refs.
- [x] Findings include their evidence artifact refs.
- [x] The top-level `artifacts` section provides the full artifact index.
- [x] Finding IDs use the Validation Run-scoped form such as `by-1-09224d806043.v2-F1`.
- [x] Artifact refs use the agreed artifact ref format.
- [x] Unknown Task IDs are command errors.
- [x] Unknown Validation Run IDs are command errors.
- [x] `validation-run` is a top-level command group.

## Blocked by

- 012-run-check-commands-and-create-check-findings.md
