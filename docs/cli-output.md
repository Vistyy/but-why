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
A `nothing_to_submit` Submission does not report phases because it does not run validation.

Each phase reports one start line and one completion line.
Each completion line contains `passed` or `failed` and the elapsed duration.
Reviewer start lines contain the Agent Profile name, complete model identifier, and thinking level.
Progress does not stream command output or reviewer reasoning.
Progress does not include Candidate, Change, Validation Run, or other durable UUIDs.

## Result design

Each command returns the smallest default schema that supports its normal next decision.
Navigation commands return identities, lifecycle state, aggregate counts, durable references, and valid next commands.
They omit bodies, repeated evidence, and historical detail owned by another command.

Mutation results report the smallest resulting persisted state needed to verify the mutation and choose the normal next action.
A successful result is authoritative for every committed field it returns.
Content mutations return complete persisted text once when that text is required for verification.
An empty successful result states its applied scope and reports a zero count.

When a result omits detail, it includes the exact public command that retrieves the detail.
A complete result omits unnecessary expansion guidance.

## Shared Repository State errors

Commands that read Shared Repository State classify storage failures into stable results.
Each classification keeps the same meaning in TOON and JSON.

- `state_store_unavailable` reports that Shared Repository State cannot be opened or queried.
  It covers an unavailable state path, SQL operation failure, and migration failure.
- `persisted_data_invalid` reports that stored records cannot be decoded as the expected structure.
  It includes the `operation` that failed to decode and no other identifiers.
  It does not describe the data as unavailable and does not claim that But Why repairs the data.
- `restored_transient_state` reports that Shared Repository State contains retired Task or Change lifecycle states.
  It stops before migration creates resumable or terminal facts.
  It identifies every affected Task and Change fact under `tasks` and `changes`.
- `shared_state_identity_conflict` reports that Shared Repository State belongs to a different Git repository.

Expected domain conflicts remain operation-specific results.
Programmer defects remain `internal_error`.
The `persisted_data_invalid` result does not include Submit Recovery Guidance and does not authorize an Implementer to repair Shared Repository State.
The `restored_transient_state` result does not include Submit Recovery Guidance and does not authorize an Implementer to repair Shared Repository State.

## Findings and Validation Runs

Finding inspection and failed Submission results preserve complete Findings, diagnostic details, and Artifact references needed for recovery.
A Validation Run retains its immutable Validation Policy Snapshot, round outcomes, Findings, Tooling Failures, and Artifact metadata.
`by validation-run show` provides Artifact detail commands and previews for Findings or tooling-failed runs.
`by validation-run artifact` returns complete stored Artifact content.

`by change show` reports Finding and Validation Tooling Failure counts instead of repeating complete diagnostic records.
A nonzero Finding count includes `by change findings <change-id>`.
A tooling-failed current Validation Run includes `by validation-run show <validation-run-id>`.

`by change validation-runs` reports every Validation Run identity, Candidate identity, state, outcome, and timestamp.
It also reports total, outcome, and running counts.

## Submit Recovery Guidance

Change Submit places Submit Recovery Guidance under `error.recovery` for `dirty_work`, `validation_findings`, and `change_base_not_ancestor`.
The recovery object contains `authority: "change_submit"`, the exact `changeId`, a machine-readable action, an instruction, and a retry command.
The guidance authorizes the Implementer to perform that exact recovery without additional user approval.
Concrete repository safety constraints still apply.

`change_blocked` reports the existing Implementation Blocker command and does not contain `error.recovery`.
Uncertain and operator-owned Submit failures retain ordinary help and do not authorize Implementer recovery.

## Managed Worktree recovery

A resumed Task Change Start or `by change prepare <change-id>` recovers a missing or stale Managed Worktree for an open Change.
Recovery reattaches the exact recorded Repository Branch at its current commit when the branch exists and is not attached elsewhere.
It never resets, rebases, replaces, or guesses a commit, and it never overwrites or removes conflicting files.

The result of a successful recovery is the normal Change result with the recorded branch, starting commit, and worktree path.
A recovery that must stop returns a nonzero result with the Change identity and actionable facts under `error`.

- `managed_branch_missing` reports that the recorded Repository Branch does not exist, with the recorded branch, starting commit, and worktree path.
  The operator may recover the branch externally or cancel the Change or its linked Task.
- `managed_branch_attached` reports that the recorded Repository Branch is attached to another worktree, including the `attachedPath`.
  The operator may remove or relocate that worktree or cancel the Change or its linked Task.
- `managed_worktree_path_conflict` reports that the recorded Managed Worktree path contains conflicting files, with the worktree path.
  The operator may move the conflicting files aside or cancel the Change or its linked Task.
- `managed_worktree_path_unavailable` reports that the recorded Managed Worktree path cannot be created because its parent containers are unavailable or unwritable.
- `change_start_conflict` reports that the recorded path or branch is already owned by another worktree or Change.

Each stopped recovery preserves the conflicting files, the recorded branch, and any worktree registration it did not create.

## Collections

A collection result reports the returned count.
A bounded collection also reports the total matching count before the limit.
Filtering and deterministic ordering occur before limiting.
A truncated collection includes the exact command that retrieves the complete matching inventory.

`by task list` returns the oldest five matching Tasks by default.
`--limit <positive integer>` changes the bound and `--limit all` returns the complete matching inventory.
Its `count` is the number of returned Tasks and its `total` is the number matching the filters before limiting.

## Command ownership

- `by task show` owns Task lifecycle, dependency, Task Review summary, and linked Change metadata.
- `by task submit` returns one structured Task Review result: `passed`, `blocked`, or `tooling_failed`, with the reviewed Task state and a valid next action.
- `by task reviews` owns compact complete Task Review History for one Task.
- `by task-review show` owns one Task Review's exact proposal, policy result, Findings, Tooling Failures, completion-failure diagnostic, and retained Session and Transcript references.
- `by task-review abandon` owns interrupted Task Review cleanup and abandonment.
- `by task context` owns the complete Task title, description, and approved Resolution context.
- `by change show` owns current implementation, validation, delivery, blocker, and cleanup state.
- `by change blocker list` owns complete Implementation Blocker and Implementation Blocker Resolution history.
- `by change findings` owns complete Findings for the current Candidate.
- `by change validation-runs` owns compact complete Validation Run History.
- `by validation-run show` owns one Validation Run's policy and recorded evidence.
- `by validation-run artifact` owns complete stored Artifact content.

The applicable command help and public tests are the executable interface contract.
