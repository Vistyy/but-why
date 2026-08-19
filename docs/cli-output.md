# CLI Output

This document defines cross-command output design for contributors implementing or reviewing the `by` CLI.
Generated command help and supported CLI tests own command-specific syntax and result fields.

## Output boundary

Each command constructs one structured result before serialization.
Domain modules do not depend on stdout serialization.

The CLI writes each result as one compact JSON document followed by one line feed.
It does not support runtime output-format selection.
[ADR 0011](adr/0011-use-json-as-the-only-cli-result-format.md) records this decision.

Stdout contains the structured result, including structured errors.
Stderr contains progress and runtime diagnostics that are not part of the result.
Progress must not replace, modify, or be required to decode the stdout result.

## Result design

A command returns the smallest schema needed to verify its result and select a normal next action.
Summary results contain only the identities, state, counts, durable references, and next commands required for that decision.
Detail commands own complete content and historical evidence.

Mutation results contain the committed facts needed to confirm the mutation.
A successful mutation result is authoritative for every committed field it returns.
When complete persisted content is required for verification, the mutation returns that content once.
An empty successful result identifies its applied scope and reports a zero count.

When omitted detail is required for the next decision, the result provides the exact public command that retrieves it.
A complete result omits unnecessary expansion guidance.

## Collections

A collection reports the number of returned records.
A bounded collection also reports the total matching count before the limit.
Filtering and deterministic ordering occur before limiting.
A truncated collection provides the exact command that retrieves the complete matching inventory.

## Errors and recovery

An error result provides a stable machine-readable code, a message, relevant operation facts, and actionable help when a supported correction is known.
Known dependency failures are translated into But Why terms when that translation gives the caller a supported next action.
Unexpected defects use `internal_error` and do not expose stack traces on stdout.

Help describes an available action but does not grant authority to mutate repository state.
When an operation can authorize recovery, that authority must be explicit structured data tied to the exact operation and target.
Portable workflow instructions define how the applicable actor uses that authority.

Shared Repository State failures preserve distinct classifications for unavailable state, invalid persisted data, and repository identity conflicts.
Operation-specific codecs and tests own their exact fields.

## Progress

Long-running commands may report concise phase progress on stderr.
Progress identifies only information useful while the operation runs and does not stream command output or reviewer reasoning.
The final stdout result remains the authoritative completion observation.

## Interface authority

The command tree and generated help own command syntax and options.
Output codecs own serialization schemas.
Supported CLI tests own observable command behavior and compatibility.
This document owns only the cross-command design rules above.
