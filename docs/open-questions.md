# Open questions

This file tracks only unresolved product and architecture questions.

Do not add backlog, follow-up work, or completed decisions here.

Settled decisions belong in `docs/architecture.md` or `docs/adr/`.

## Sandcastle

Open questions:

- What Pi token usage does Sandcastle return for the selected runtime and model?
- Does v1 advertise Podman support?
- If v1 advertises Podman support, what smoke test is required?

## Task readiness and orchestration

We need to decide how task readiness, refinement, implementation, and escalation should work after the validation-focused v1 path.

Open questions:

- How should undercooked tasks be detected before implementation?
- Should refinement be a state, a tag, a command, or a separate loop?
- How should users handle centralized escalation across many tasks?
- Should `by` orchestrate implementation, or should agents use `by` commands directly?

This must stay distinct from the Validation Gate, which validates a completed submission.

## Task metadata, tags, and routing

Tasks may need metadata for classification, routing, automation policy, and scheduling.

Open questions:

- Which needs belong in lifecycle state?
- Which needs belong in tags?
- Which needs deserve first-class fields or relationships?
- Should tags influence validation profiles or reviewer selection?
- Should categories such as UI change validation behavior?
- Which semantics must But Why? enforce instead of treating them as labels?

## Task relationships and dependencies

Tasks may need relationships so related work and dependencies are visible.

Open questions:

- What relationship types exist?
- Do dependencies block `todo`, `implementing`, or `submit`?
- How do related and blocked tasks appear in dashboards?
- Are relationships local-only, or must they map to future external Task Surfaces?

This is not part of validation-focused v1 unless explicitly pulled in.

## Validation phase configuration

V1 uses fixed phases instead of a generic CI pipeline.

The remaining config shape is open for whether check commands should support argv arrays after Sandcastle supports argv-native execution.

The config should stay small and should not become a generic workflow language.

## Quality Reviewer role set

Acceptance Review is mandatory.
Quality Reviewer roles remain configurable and are not fixed by the v1 architecture.

We still need to decide the default Quality Reviewer set created by `by init`.

Candidate roles:

- bugs
- simplicity
- domain
- documentation

## GitHub readiness details

V1 requires GitHub PR publishing.

We still need exact rules for `ready`:

- required checks only or all checks
- requested-changes review handling
- draft PR handling
- timeout default
- closed PR without merge behavior

Current direction: a PR is ready only when GitHub says it is mergeable, required checks pass, and no active requested-changes review blocks it.

## Agent profiles and Sandcastle mapping

We chose `agentRuntime` and `agentModel` instead of `provider` and `model`.

We still need to map profile fields to Sandcastle provider options.

Open details:

- environment variables
- session storage
- log locations
- provider-specific permissions

## Token accounting

V1 records tokens, not dollar costs.

We still need to verify how each Sandcastle runtime maps its output into the canonical buckets:

```text
inputTokens
cachedInputTokens
outputTokens
totalTokens
```

## Observability beyond local records

V1 stores runs, rounds, logs, artifacts, findings, and token usage locally.

We still need to decide whether later versions should export traces to:

- OpenTelemetry
- Langfuse
- Braintrust
- another existing observability tool

No custom dashboard should be built early.
