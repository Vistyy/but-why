# Validate config and reviewer contracts with Effect Schema

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Centralize runtime validation for configuration and reviewer contracts with Effect Schema.

The goal is to validate external data at boundaries and convert decode failures into typed validation workflow errors.

This should avoid hand-rolled JSON shape checks for config, reviewer output, Findings, and token usage records.

Sandcastle should still own structured output retry for reviewer agents.

But Why should validate the final structured output against its own contract before storing results.

## Resolved decisions

Repo Config owns validation policy, including validation commands, sandbox policy, and reviewer selection.
Global Config owns reusable local settings, including Agent Profiles, and is not a runtime fallback for repository validation policy.

Token usage records use canonical `inputTokens`, `cachedInputTokens`, `outputTokens`, and `totalTokens` buckets.
Missing `cachedInputTokens` normalizes to `0`.
Missing `totalTokens` normalizes to `inputTokens + outputTokens`.
Missing `inputTokens` or `outputTokens` is a typed tooling error.
An absent token usage payload produces no Token Usage Record.

Config schemas reject unknown keys so misspelled or unsupported settings fail at the boundary instead of being silently ignored.

Reviewer output validates reference shape at schema decode time, not reference existence.
Reviewer `files` entries must be repo-relative paths.
Reviewer `artifactRefs` entries must use the canonical artifact ref shape: `artifact:<validation-run-id>/<phase>/<producer>/<filename>`.
Existence checks for files or artifacts belong outside schema decode because they need repository or artifact-storage context.

Shared external contracts live behind one boundary module, `src/contracts/`.
That module owns repo config, global config, reviewer output, and token usage schemas plus decode helpers that preserve actionable Effect Schema diagnostics.
Domain modules consume decoded values instead of parsing external data directly.

Reviewer config and Agent Profile config stay separate.
Agent Profiles define how to run an agent, including runtime, model, and optional thinking level.
Reviewers define a review role, including the instructions file and which Agent Profile to use.
A reviewer may also define `agentRuntime`, `agentModel`, and optional `thinking` directly instead of using a named Agent Profile.
A reviewer must use either `profile` or inline `agentRuntime` plus `agentModel`, not both.
For Pi-backed agents, `thinking` uses Pi's canonical values: `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

Schema validation owns external-data shape and primitive constraints: required fields, enum values, unknown keys, non-empty strings or arrays, and ID, path, or artifact-ref format.
Semantic validation owns project meaning and context-dependent rules such as duplicate check IDs, reviewer profile resolution, and whether a configured command can run in its phase.

`ignorePatterns` is not part of v1 config.
The public config example should omit it and the schema should reject it as an unknown key.

Schema decode errors must include the bad value path, the expected value shape, the actual value, and a short message.
Typed config or reviewer tooling errors expose those diagnostics so an agent can repair the source data without guessing.

Invalid repo config, invalid global config, and invalid reviewer profile configuration reject submit before But Why creates a Submission, a Validation Run, or any Findings.

Invalid reviewer JSON after Sandcastle structured-output retry is exhausted records a Validation Tooling Failure on the existing Validation Run.
It does not create a Finding, because the submission was not judged.
After that tooling failure, the Task returns to its previous submit-ready state.

Reviewer structured output has exactly one top-level field, `findings`, and rejects unknown top-level fields.

## Implementation boundary

This issue provides the decoded contracts and typed failures consumed by validation orchestration.
Issues 014 and 015 own reviewer execution and call the reviewer output contract after Sandcastle exhausts structured-output retries.
Issue 018 owns token usage persistence and calls the token usage contract when ingesting Sandcastle usage payloads.
The existing Validation Runs seam records typed reviewer contract failures without Findings and restores the Task's submit-ready state.

## Acceptance criteria

- [ ] Repo config is decoded through Effect Schema or a schema built on the same contract.
- [ ] Global config is decoded through Effect Schema or a schema built on the same contract.
- [ ] Reviewer Finding output is decoded through Effect Schema.
- [ ] Token usage summaries are decoded or normalized through a documented schema contract.
- [ ] Schema decode errors become typed config or reviewer tooling errors.
- [ ] Invalid reviewer JSON after Sandcastle structured-output retry is exhausted records a tooling error, not a Finding.
- [ ] Schema validation errors are actionable enough for an agent to repair config or reviewer output.
- [ ] The public config examples in `docs/config.md` match the implemented schemas.
- [ ] Tests cover valid config, invalid config, valid reviewer Findings, and invalid reviewer output.

## Blocked by

- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
