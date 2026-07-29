# Agent-first CLI output

Status: Current engineering standard

This document defines the output policy for the `by` command interface.
It refines the general AXI guidance for But Why's Task, Change, Validation Run, and Artifact records.

## Output boundary

Each command must construct one structured result before serialization.
TOON and JSON must serialize the same result fields and semantics.
TOON remains the default format for direct agent use.
Programmatic callers must request JSON with `--output json`.
Domain modules must not depend on either serialization format.

## Default success schema

Each command must have one default success schema.
The default schema must contain the smallest set of facts that supports the command's normal next decision.
A command must not serialize a complete persistence record or domain record unless every returned field supports that decision.
A command must not provide lean and full modes when another command already owns the omitted detail.

Navigation and state commands must prefer identities, lifecycle state, readiness, aggregate counts, durable references, and valid next commands.
Navigation and state commands must omit bodies, resolved configuration, repeated evidence, and historical detail that another command owns.

Evidence commands must return the evidence necessary for their stated inspection job.
An evidence command may omit content owned by a narrower evidence command when it retains the durable reference and exact expansion command.

Mutation results must report the resulting state and the durable identifiers needed to verify the mutation.
Mutation results must not repeat unrelated prior state.

An empty successful result must state the applied scope or filter and report a zero count.

## Expansion paths

When a command omits detail owned by another command, the result must include the exact command that retrieves that detail.
Expansion guidance must preserve selected identifiers and repository-scoping arguments.
A command must not require an agent to infer an identifier that the result does not provide.
A complete result must omit unnecessary expansion guidance.

Omitted detail must remain reachable through the public CLI.
Do not remove the only public representation of immutable historical evidence.

## Findings, failures, and Artifacts

Finding inspection and failed Submission results must preserve complete Findings and Artifact references.
Failure results must preserve the exact error code, decisive diagnostics, valid recovery command, and exit code.
Output reduction must not replace a specific failure with a generic summary.

Validation Run inspection must preserve its immutable Validation Policy Snapshot, phase rounds, Findings, and Validation Tooling Failures.
Validation Run inspection must preserve metadata, references, and exact detail commands for every Artifact.
Validation Run inspection must include previews for Artifacts referenced by Findings.
A tooling-failed Validation Run must include every available Artifact preview because Validation Tooling Failures do not identify Artifact references.
Validation Run inspection may omit previews for unrelated successful Artifacts.
`by validation-run artifact` must preserve its complete stored-content behavior.

## Collections and limits

A collection result must report the returned count.
A bounded collection must also report the total matching count before the limit.
Filtering and deterministic ordering must occur before limiting.
A truncated collection must include the exact command that retrieves the complete matching inventory.

Do not add a limit without observed collection size or usage evidence.
Do not add pagination when one bounded result and one complete-inventory command satisfy the observed job.

## Command ownership

`by task show` owns Task lifecycle, dependency, and linked Change metadata.
`by task context` owns the complete Task title, description, comments, and approved Resolution context.

`by change show` owns current implementation, validation, delivery, blocker, and cleanup state.
`by change findings` owns complete Findings for the current Candidate.
`by change validation-runs` owns compact complete Validation Run History.
`by validation-run show` owns one Validation Run's immutable policy and recorded evidence.
`by validation-run artifact` owns complete stored Artifact content.

`by change show` must report Finding and Validation Tooling Failure counts instead of repeating their complete records.
A nonzero Finding count must provide the exact `by change findings <change-id>` command.
A tooling-failed current Validation Run must provide the exact `by validation-run show <validation-run-id>` command.

Validation Run History must retain every Run's identity, Candidate identity, state, outcome, and timestamps.
Validation Run History must report total, outcome, and running counts.
Validation Run History must provide the `by validation-run show <validation-run-id>` expansion pattern.
Validation Run History does not require a limit until observed history size justifies one.

## Exceptions and verification

A command may retain additional detail only when repository evidence shows that the detail changes the normal next decision or prevents an additional diagnostic query.
The applicable command documentation or test must make that reason observable.

CLI boundary verification must cover equivalent TOON and JSON semantics, empty results, success results, errors, exit codes, aggregate counts, truncation, and every expansion path.
Diagnostic verification must prove that omitted evidence remains reachable and that failure output retains the information required for recovery.
