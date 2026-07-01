# Open questions

## Sandcastle spike result

Result: green-ish.
Sandcastle has released the required `.exec` method, so product implementation is approved to proceed, but some Sandcastle follow-up issues are still in progress.
Token-usage verification remains open.

The spike report lives at:

```text
docs/spikes/sandcastle-v1-execution.md
```

Sandcastle main commit `2d93226d37da129c54d4ecfd5b370122b48b31b2` proved:

- validation worktrees from temp refs
- configured check commands through `sandbox.exec()`
- Pi reviewer agents
- structured output validation and retry through `Output.object(..., maxRetries)`
- reviewer log file paths
- Docker sandbox execution
- Pi reviewer execution in Docker with host Pi auth mounted read-only
- cleanup

Remaining open points:

- Pin a Sandcastle release that includes the required `.exec` API.
- Verify Pi token usage for the selected runtime and model, because `result.iterations[].usage` was missing in the local run.
- Track remaining Sandcastle follow-up issues that could affect v1 execution behavior.
- Optionally run a Podman smoke test if v1 wants to advertise Podman support.

## Task readiness and orchestration

We need to decide how task readiness, refinement, implementation, and escalation should work after the validation-focused v1 path.

Open concerns:

- Many tasks may be too undercooked to implement safely.
- The user should not have to manually refine every task with the main agent.
- Refinement should be mostly automated if it exists.
- Future refinement must support centralized escalation across many tasks without requiring the user to enter each task's agent session.
- The exact shape of that centralized escalation mechanism is undecided.

Possible lifecycle ideas include adding states before `todo`, such as `draft` or `refining`, but these are not yet accepted domain states.

Possible future loops include:

- a task-readiness or refinement loop before implementation
- an implementation loop that turns ready tasks into committed code ready for submission
- the current validation loop that validates completed submissions

Open implementation options include:

- an agent reads Task Context and uses `by` commands directly
- `by` triggers an implementation loop through the CLI
- But Why? orchestrates loops programmatically through its own solution

This must stay distinct from the Validation Gate, which validates a completed submission and is not a generic pipeline.

## Task metadata, tags, and routing

Tasks may need metadata for classification, routing, automation policy, and scheduling.

Tags are a candidate mechanism, but some needs may deserve first-class fields or relationships instead.

Open questions include:

- whether lifecycle readiness belongs in state, tags, or another concept
- how to represent tasks that should exist but not be touched yet
- how to represent tasks that are ready but should not be automated
- whether tags should influence validation profiles or reviewer selection
- whether task categories such as UI need different validation loops
- which semantics must be enforced by But Why? instead of treated as loose labels

## Task relationships and dependencies

Tasks may need relationships so related work and dependencies are visible.

Open questions include:

- what relationship types exist
- whether dependencies block `todo`, `implementing`, or `submit`
- how related tasks and blocked tasks appear in dashboards
- whether relationships are local-only or must map to future external Task Surfaces

This is not part of validation-focused v1 unless explicitly pulled in.

## Validation status

The v1 validation model is architecturally decided, but several details remain open.

Settled for v1:

- `by submit <task-id>` starts validation.
- Validation is synchronous.
- Validation checks a completed committed branch.
- Validation uses fixed Validation Gate phases.
- Validation is distinct from refinement and implementation.
- Any Finding moves the Task to `needs_input`.
- Clean validation publishes or updates a GitHub PR.

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
