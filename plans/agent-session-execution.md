# Agent Session and execution plan

**Status:** Paused pending the Task Intent extraction boundary.
The Change Delivery portions may remain applicable, while Task Review execution may move to another product.
Do not use this plan as current planning direction or implementation authority.

**Removal condition:** Remove this file after the approved behavior is implemented, recorded in applicable current architecture and domain authorities, and represented by completed SQLite Tasks.

## Outcome

Task Review, Change reviewers, and the Publication Agent use one shared Agent Session and Agent Execution capability for mechanics they currently share.
Task Intent and Change Delivery retain role policy, prompts, structured results, Findings, lifecycle effects, and recovery decisions.
Pi remains the only headless Agent Harness implemented for the first release.
Herdr remains the default Interactive Session Host.

The design keeps harness-specific and local-process knowledge local enough that a future harness or remote execution module can be introduced without rewriting Task Review, Validation, or Candidate Publication policy.
It does not claim that current execution is location-transparent.

## Shared concepts

### Agent Session

An Agent Session is the permanent logical relationship between one domain owner and one domain-defined role.
The owning domain defines the role and determines when continuation is eligible.
A session can retain a current physical harness continuation while that continuation remains compatible and usable.
A changed stable setup or unusable continuation starts a fresh physical harness session while preserving the logical Agent Session.

Compatibility includes the resolved Agent Profile, role instructions, Agent Environment, tools, skills, and extensions.
Candidate identity, prompt content, workspace path, Review identity, and publication source digest do not determine session compatibility.

Session and transcript evidence remains inspectable after continuation ends.
The first release adds no retention policy.

### Agent Execution

An Agent Execution is one requested unit of agent work owned by a domain operation.
Examples include one Task Review execution, one Validation Review execution, and one publication-presentation generation.
The domain operation creates and settles its execution as part of its own durable lifecycle.

An Agent Invocation is one ordered harness launch or resume within an Agent Execution.
Invocation evidence distinguishes an attempted dispatch with unsettled return evidence from a settled harness return.
Recovery reconciles an unsettled Invocation before retry.

Shared execution evidence can include:

- Harness, provider when known, model, and optional thinking level.
- Input, output, cache-read, cache-write, and total token usage when the harness reports it.
- Continuity and a bounded restart reason when a physical continuation is replaced.
- Transcript references discovered for the physical harness session.

Monetary cost and generic harness-specific metadata are excluded until a supported use and evidence contract require them.

## Ownership

Shared Agent Session execution owns:

- Session compatibility.
- Harness launch or resume mechanics.
- Same-session structured-output correction mechanics.
- Invocation settlement evidence.
- Transcript discovery and references.
- Harness-specific usage extraction.

Task Intent and Change Delivery own:

- Whether agent work may start or continue.
- Agent role instructions and supplied authority.
- Output decoding and domain interpretation.
- Review or publication outcomes.
- Findings and lifecycle effects.
- Atomic persistence of the domain outcome with settled execution evidence.
- Recovery decisions for unfinished domain work.

A Publication Agent uses Agent Sessions without becoming a Review.
Review policy and publication synthesis remain separate domain behavior.

## First-release execution boundaries

The shared capability should depend on a narrow harness Adapter for current headless agent execution.
The Adapter should not expose Pi transcript formats, Pi command flags, or local process details to Task Review, Validation, or Publication workflows.

`InteractiveSessionHost` remains a distinct seam for visible Implementer sessions.
Shared mechanics can be reused where evidence supports the same contract, but visible hosting, operator interaction, and headless result settlement must not be forced into one shallow interface.

Local command execution for Repository Preparation and Checks remains separate from Agent Execution.
The first release does not create one universal executor for agents, commands, containers, remote workers, and interactive terminals.

## Future execution direction

A future cloud or remote implementation would need more than another process launcher.
It would need explicit contracts for:

- Exact repository or Candidate input transfer.
- Writable or read-only authority.
- Credential and secret delivery.
- Produced commits, structured results, logs, and evidence.
- Dispatch settlement, cancellation, timeout, and recovery.
- Continuation identity across machines or services.

These contracts remain deferred until a concrete execution provider or bounded spike establishes them.
The first-release interfaces should avoid unnecessary local details but should not invent these semantics.

A future background Implementer may use Agent Execution mechanics while retaining Implementer-specific authority and Change lifecycle policy.
Another visible Interactive Session Host may replace Herdr through its existing host boundary.

## Persistence direction

The release baseline needs durable representation for logical sessions, executions, invocations, and transcript references because they have distinct write and recovery lifecycles.
The physical schema must be selected through the release-baseline review rather than copied from the prerelease Reviewer Session schema.

Keep domain Review and publication outcomes with their owners.
Do not introduce generic owner, workflow, run, phase, producer-registry, or plugin tables solely for future extensibility.
Use direct ownership representation where it is sufficient, with application enforcement for cross-domain relationships when generic relational machinery would add more complexity than safety.

## Verification direction

A representative Task Review and Change reviewer operation must establish that the shared capability preserves current behavior through the supported operation.
Candidate Publication must establish that a non-reviewing agent can use the same session and execution mechanics without inheriting Review policy.
Interruption evidence must distinguish unsettled dispatch from a returned invocation before retry behavior is accepted.

## Decisions still required

- Finalize the smallest owner representation for Agent Sessions.
- Finalize the exact settlement transaction boundary shared mechanics prepare for each domain owner.
- Finalize the minimum persistent invocation and transcript evidence required by current inspection and recovery.
- Decide whether the current Review persistence should remain domain-specific or share only a thin identity after reviewing actual current queries and invariants.
- Select the released schema only after these decisions are accepted.

## Exclusions

The first release does not include:

- A second headless Agent Harness.
- Cloud or cross-machine agent execution.
- Sandboxed command or agent execution.
- A generic command-and-agent execution backend.
- Arbitrary workflow steps or lifecycle hooks.
- Monetary cost accounting.
- An Agent Session retention policy.

## Authorization status

No implementation or Task Recording is authorized by this plan.
