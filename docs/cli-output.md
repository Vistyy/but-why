# CLI Output

This document defines the current output contract for the `by` CLI.
The audience is an agent or program that must choose the next repository action from command output.

## Output boundary

Each command constructs one structured result before serialization.
TOON and JSON serialize the same result fields and semantics.
TOON is the default stdout format.
Programmatic callers request JSON with `--json` before the command.
Domain modules do not depend on either serialization format.

`by --version` returns the authoritative package version in a structured `version` field.
The default TOON result is `version: 0.0.1` for the current package version.
`by --json --version` returns the equivalent JSON object `{"version":"0.0.1"}`.
The value comes from the packaged `package.json` metadata.

## Change Submit progress

`by change submit` writes concise human-readable phase progress to stderr while it runs.
The progress is not part of the structured result.
The command continues to write one structured TOON or JSON result to stdout.

Progress reports only phases that run for the Submission.
A changed Candidate can report Prepare, each configured Check, Acceptance Review for a Task-backed Change, and each configured Specialist Review.
A Taskless or no-change Submission does not report phases that it does not run.

Each phase reports one start line and one completion line.
Each completion line contains `passed` or `failed` and the elapsed duration.
Reviewer start lines contain the Agent Profile name, complete model identifier, and thinking level.
Progress does not stream command output or reviewer reasoning.
Progress does not include Candidate, Change, Validation Run, or other durable UUIDs.

## Result design

Each command returns the smallest default schema that supports its normal next decision.
Navigation commands return identities, lifecycle state, readiness, aggregate counts, durable references, and valid next commands.
They omit bodies, repeated evidence, and historical detail owned by another command.

Mutation results report the resulting state and durable identifiers needed to verify the mutation.
An empty successful result states its applied scope and reports a zero count.

When a result omits detail, it includes the exact public command that retrieves the detail.
A complete result omits unnecessary expansion guidance.

## Findings and Validation Runs

Finding inspection and failed Submission results preserve complete Findings, diagnostic details, and Artifact references needed for recovery.
A Validation Run retains its immutable Validation Policy Snapshot, phase outcomes, Findings, Tooling Failures, and Artifact metadata.
`by validation-run show` provides Artifact detail commands and previews for Findings or tooling-failed runs.
`by validation-run artifact` returns complete stored Artifact content.

`by change show` reports Finding and Validation Tooling Failure counts instead of repeating complete diagnostic records.
A nonzero Finding count includes `by change findings <change-id>`.
A tooling-failed current Validation Run includes `by validation-run show <validation-run-id>`.

`by change validation-runs` reports every Validation Run identity, Candidate identity, state, outcome, and timestamp.
It also reports total, outcome, and running counts.

`by change publications` reports the complete ordered immutable Candidate Publication history.
It returns an explicit zero-count result when no Candidate Publication exists.

## Submit Recovery Guidance

Change Submit places Submit Recovery Guidance under `error.recovery` for `change_not_ready`, `dirty_work`, `validation_findings`, and `change_base_not_ancestor`.
The recovery object contains `authority: "change_submit"`, the exact `changeId`, a machine-readable action, an instruction, and a retry command.
The guidance authorizes the Implementer to perform that exact recovery without additional user approval.
Concrete repository safety constraints still apply.

`change_blocked` reports the existing Implementation Blocker command and does not contain `error.recovery`.
Uncertain and operator-owned Submit failures retain ordinary help and do not authorize Implementer recovery.

## Collections

A collection result reports the returned count.
A bounded collection also reports the total matching count before the limit.
Filtering and deterministic ordering occur before limiting.
A truncated collection includes the exact command that retrieves the complete matching inventory.

`by task list` returns the oldest five matching Tasks by default.
`--limit <positive integer>` changes the bound and `--limit all` returns the complete matching inventory.
Its `count` is the number of returned Tasks and its `total` is the number matching the filters before limiting.

## Command ownership

- `by task show` owns Task lifecycle, dependency, and linked Change metadata.
- `by task context` owns the complete Task title, description, comments, and approved Resolution context.
- `by change show` owns current implementation, validation, delivery, blocker, and cleanup state.
- `by change blocker list` owns complete Implementation Blocker and Implementation Blocker Resolution history.
- `by change findings` owns complete Findings for the current Candidate.
- `by change validation-runs` owns compact complete Validation Run History.
- `by change publications` owns complete Candidate Publication history.
- `by validation-run show` owns one Validation Run's policy and recorded evidence.
- `by validation-run artifact` owns complete stored Artifact content.

The applicable command help and public tests are the executable interface contract.
