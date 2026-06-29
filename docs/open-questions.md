# Open questions

## Sandcastle spike result

Sandcastle is the intended v1 execution engine, but this is not proven yet.

The first prototype must decide whether Sandcastle cleanly supports:

- validation worktrees from temp refs
- configured check commands
- Pi reviewer agents
- structured output validation and retry
- logs and artifacts
- token usage
- cleanup

If the spike fails, decide whether to patch Sandcastle, contribute upstream, or narrow v1.

## Validation phase configuration

We have chosen fixed phases instead of a generic CI pipeline.

The remaining question is the exact shape of repo config for:

- check commands
- intent reviewer
- quality reviewers
- sequential versus parallel reviewer groups
- timeouts
- ignore patterns

The config should stay small and should not become a generic workflow language.

## Reviewer role set

Reviewer roles are configurable and are not fixed by the v1 architecture.

We still need to decide the default reviewer set created by `by init`.

Possible roles include:

- intent
- bugs
- simplicity
- domain
- documentation

## GitHub readiness details

V1 requires GitHub PR publishing.

We still need exact rules for `ready`:

- required checks only or all checks
- requested changes review handling
- draft PR handling
- timeout default
- closed PR without merge behavior

Current direction: a PR is ready only when GitHub says it is mergeable, required checks pass, and no active requested-changes review blocks it.

## Agent profiles and Sandcastle mapping

We chose `agentRuntime` and `agentModel` instead of provider/model.

We still need to map profile fields to Sandcastle provider options.

Open details include:

- Pi thinking settings
- sandbox defaults
- environment variables
- session storage
- log locations
- provider-specific permissions

## Token accounting

V1 records tokens, not dollar costs.

We still need to verify what Sandcastle returns for each runtime and normalize it into:

```text
inputTokens
cachedInputTokens
outputTokens
totalTokens
```

Dollar costs are deferred.

## Evals

Reviewer agents need evals from the beginning.

The unresolved question is how formal those evals need to be in v1.

At minimum, we need golden fixtures for task context plus diff plus expected findings behavior.

## Observability beyond local records

V1 stores runs, rounds, logs, artifacts, findings, and token usage locally.

We still need to decide whether later versions should export traces to:

- OpenTelemetry
- Langfuse
- Braintrust
- another existing observability tool

No custom dashboard should be built early.
