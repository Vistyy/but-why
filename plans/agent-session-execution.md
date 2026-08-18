# Agent Session and invocation plan

**Status:** Approved planning direction.
BY-275 completed the Agent Session and Agent Invocation design captured here, and this plan supplies its exact contracts to BY-274.
This plan is separate from and consistent with the accepted modular-monolith direction in `task-change-boundary.md`.
It is not implementation authority.

**Removal condition:** Remove this file after the approved behavior is implemented, recorded in applicable current architecture and domain authorities, and represented by completed SQLite Tasks.

## Outcome

BY-269 and BY-271 are completed planning and implementation predecessors, and BY-275 is the completed Agent Session prerequisite, for the direct BY-274 baseline cutover.
BY-274 acceptance is limited to the exact baseline implementation and retained supported behavior.
The separately authorized live operator cutover follows merged Change reconciliation, which closes the Change and marks the BY-274 Task Done in old state before the backup rename or fresh initialization.
The later live steps are not a Task completion condition, and post-baseline sequencing resumes only after the minimum live operation succeeds.
Task Review and Change reviewers use shared Agent Session and Agent Invocation capabilities for mechanics they currently share.
Candidate Publication may adopt these capabilities later but is not part of the initial Agent Session work.
Tasks and Changes retain role policy, prompts, structured results, Findings, lifecycle effects, and recovery decisions.
The first-release shared capability supports only headless reviewers.
Pi remains its only Agent Harness.
Names may remain role-neutral, but the implementation adds no behavior for Publication Agents or background Implementers.
Herdr remains the default Interactive Session Host.

The design keeps harness-specific and local-process knowledge local enough that a future harness or remote execution module can be introduced without rewriting Task Review, Validation, or Candidate Publication policy.
It does not claim that current execution is location-transparent.

## Shared concepts

### Agent Session

An Agent Session is the permanent logical relationship between one domain owner and one domain-defined role.
Initial examples are the Task Reviewer for one Task, the Acceptance Reviewer for one Change, and one named Specialist Reviewer for one Change.
An Agent Session is never reused across owners or roles.
The owning domain defines the role and determines when continuation is eligible.
An Agent Session has physical harness continuations ordered by their repository-local immutable integer IDs.
The highest-ID continuation is current for dispatch and recovery inspection.
It is resumable only when its transcript path is present and no unusable reason is recorded.
When no continuation exists, dispatch creates one; when the current continuation is resumable, dispatch reuses it; otherwise dispatch appends a fresh continuation while preserving the logical Agent Session and its stored resolved configuration.
Past Invocations and continuations remain history without separate replacement metadata.

The owning domain resolves and stores the Agent Profile, role instructions, Agent Environment, tools, skills, and extensions once for the applicable owner lifecycle.
A Task stores this configuration as a nullable JSON snapshot when its Task Reviewer Agent Session first launches.
A Change stores its fixed reviewer roster and each role's resolved configuration as one JSON snapshot at Change Start, before individual Agent Sessions are created lazily.
These embedded configurations have no independent relational lifecycle and do not require separate configuration tables.
Task Reviews and Validation Runs use their owner's stored reviewer configuration rather than duplicating it.
Later Repo or Global Config changes do not alter those stored configurations, add or remove Change reviewers, or replace a usable continuation.
The owning domain validates a resolved snapshot before storage.
A retry may replace only that owner-role configuration from corrected current config when no Invocation has returned, no transcript exists, and the latest Invocation settled as `launch_failed` because no conversation was established.
Replacement never changes the Change reviewer roster.
Once the harness establishes a conversation, that owner-role configuration remains fixed permanently.
Missing or unusable transcript recovery creates a replacement continuation with that same configuration rather than adopting later config.
Every later Invocation and replacement continuation for that owner-role Agent Session uses the stored configuration.
Shared Agent infrastructure does not interpret domain policy or store a compatibility fingerprint.
Candidate identity, prompt content, workspace path, and Review identity may change without replacing the continuation.

A domain stops continuation reuse when its owner can no longer use that role; shared storage needs no separate ended state.
Closing a Change prevents reuse of its reviewer continuations.
Moving a Task to `done` or `cancelled` prevents reuse of its Task Reviewer continuation, while moving it to `todo` remains eligible because Task Revision can return it to review.
Agent Session, Invocation, continuation, and transcript history remains inspectable afterward.
The first release adds no retention policy.

### Agent Invocation

An Agent Invocation is one ordered harness launch or resume for a domain-owned operation.
The domain operation, such as a Task Review or Acceptance Review, already groups its Invocations and owns their lifecycle and result.
Record an Invocation before dispatching the harness call and settle it when the harness returns.
For Pi, But Why derives a stable Pi session ID from the persisted continuation integer before launch.
If interruption leaves an Invocation unsettled, recovery first confirms that the harness process stopped and never treats an unseen return as success.
It settles the interrupted Invocation as `return_unknown`.
When the transcript exists, recovery resumes the same continuation and requests the result again through a new Invocation.
When no transcript exists, recovery records the continuation as missing, creates a new continuation, and reruns the complete domain prompt through a new Invocation.
An existing continuation that cannot resume is likewise replaced with its reason recorded before the new Invocation.

Shared Invocation evidence includes:

- A table-local immutable integer identity that orders Invocation history.
- The physical harness continuation used.
- `created_at` and nullable `settled_at` timestamps.
- An application-decoded settlement kind.
- Nullable domain `input`, `cacheRead`, `cacheWrite`, `output`, and `total` token fields stored as one all-present or all-absent measured set.
- The transcript-relative path discovered for the physical harness continuation.

Each physical continuation stores its required Agent Harness name, nullable model provider, required selected model slug, and nullable thinking level.
Domain token fields `input`, `cacheRead`, `cacheWrite`, `output`, and `total` correspond respectively to physical `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, and `total_tokens`.
All five physical token columns are either all present or all absent.
Each Invocation retains domain `input`, `cacheRead`, `cacheWrite`, `output`, and `total` token evidence when measured, and unavailable usage remains `null` rather than zero.
These dimensions describe the physical conversation and make usage queryable without repeating them on every Invocation.
The first release stores `pi` as the Agent Harness; retaining this explicit fact does not add support for another harness.
Provider remains nullable when the harness cannot report it reliably, and thinking remains nullable because it is not a capability of every harness.

Settlement kinds are stored as text and decoded by the application unless a later relational invariant requires a SQLite constraint.
The first-release values are `returned`, `launch_failed`, `failed`, and `return_unknown`.
A readable response with invalid structured output is `returned`; its correction is another Invocation.
`launch_failed` proves that no conversation was established, `failed` means the harness ran without usable returned output, and `return_unknown` records an interrupted call whose return was not observed.

For first-release Pi, derive the Pi session ID from the continuation integer and store no separate Pi session identity.
Store the explicit Agent Harness name on the continuation rather than relying on the first-release implementation choice as durable evidence.
Store one nullable transcript-relative path and one nullable unusable reason on the physical continuation and do not retain a separate transcript-reference record.
A continuation is resumable only when its transcript path is present and no unusable reason is recorded.
The reason records why its transcript cannot continue without adding a replacement pointer, generic continuation status, or superseded timestamp.
Domain operations reach that transcript through their Invocation links.
Transcript contents remain in the Pi file and are not copied into SQLite.

Invocation rows do not duplicate prompts or returned text.
Domain records retain authoritative inputs and results, while harness transcripts retain the conversation.
Monetary cost and generic harness-specific metadata are excluded until a supported use and evidence contract require them.

Public domain inspection exposes exact ordered Invocation evidence rather than retained reviewer execution aggregates.
Each Invocation projection identifies its Invocation, Agent Session, and continuation; the continuation Agent Harness, nullable model provider, model, and nullable thinking level; dispatch and settlement timestamps; settlement kind; nullable all-or-none input, `cacheRead`, `cacheWrite`, output, and total token usage; transcript-relative path; and unusable reason.
Task Review and Validation phase inspection associates each Invocation with its owning operation, phase, and producer as applicable.
Do not expose compatibility fingerprint, continuity, review-call count, or aggregate reviewer duration.
The Invocation list and timestamps provide the underlying evidence without storing or presenting those retired summaries.

## Ownership

An Invocation result records whether the harness returned usable output, not whether the domain accepts that output.
A readable but invalid domain result settles the Invocation, leaves the domain operation incomplete, and may cause a correction Invocation.
A valid domain result may complete when continuation or transcript capture fails.
The continuation records that capture failure in `unusable_reason`, while the Invocation settlement continues to describe the harness call.
The next operation starts a fresh continuation rather than converting the valid result into a tooling failure.
Each retry or correction is another Invocation, and the owning domain decides whether another attempt is allowed.
When domain recovery ends without usable output, the final Invocation failure and the domain Tooling Failure are recorded atomically.
The continuation is preserved or replaced only according to what the failure proves.
Findings, Review outcomes, and Publication outcomes remain domain records.

Shared Agent infrastructure owns:

- Applying the stored resolved setup supplied by the owning domain.
- Harness launch or resume mechanics.
- Same-session structured-output correction mechanics, with each correction call recorded as another Invocation for the same domain operation.
- Invocation settlement evidence.
- Transcript discovery and references.
- Harness-specific usage extraction.

Tasks and Changes own:

- Whether agent work may start or continue.
- Agent role instructions and supplied authority.
- Output decoding and domain interpretation.
- Review or publication outcomes.
- Findings and lifecycle effects.
- Atomic persistence of the domain outcome with settled Invocation evidence.
- Recovery decisions for unfinished domain work.

## First-release execution boundaries

The shared capability should depend on a narrow harness Adapter for current headless agent execution.
The Adapter should not expose Pi transcript formats, Pi command flags, or local process details to Task Review, Validation, or Publication workflows.

`InteractiveSessionHost` remains a distinct seam for visible Implementer sessions.
Shared mechanics can be reused where evidence supports the same contract, but visible hosting, operator interaction, and headless result settlement must not be forced into one shallow interface.

Local command execution for Repository Preparation and Checks remains separate from Agent Invocation.
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

A future background Implementer may use Agent Invocation mechanics only after its own accepted design while retaining Implementer-specific authority and Change lifecycle policy.
Another visible Interactive Session Host may replace Herdr through its existing host boundary.

## Persistence direction

Invocation settlement uses two short transactions around the external harness call.
The first refuses dispatch when that Agent Session already has an unsettled Invocation, then atomically records the new unsettled Invocation and its domain-owned operation link before dispatch and commits before the agent runs.
The existing SQLite write transaction provides sufficient serialization; do not add a separate lock, queue, scheduler, or coordination system.
The harness runs without an open database transaction.
When it returns, the second transaction atomically stores the settled Invocation evidence and the owning domain result.
Repository Runtime provides the SQLite transaction capability.
Task or Change composition connects its domain operation with narrow transaction-bound Agent storage operations.
Agent infrastructure does not access Task or Change tables.
A persistence failure therefore cannot leave an orphan Invocation or record either completion without the other.

The direct BY-274 baseline needs durable representation for logical sessions, physical continuations, and Invocations because they have distinct write and recovery lifecycles.
Prerelease reviewer records lack the per-call facts needed to reconstruct exact Invocations honestly.
The baseline does not import or convert those records.
All new reviewer work writes only the Agent Session representation.
The final baseline and released executable remove legacy Reviewer tables and readers, while the old rows remain in the dated low-value backup.
Working internal Agent Session code remains in place unless the final schema, retired legacy representation removal, or supported behavior requires a change.
Adapter relocation and general cleanup remain post-baseline hardening work.
Do not add a generic Agent Execution record because each domain operation already groups its Invocations and owns its lifecycle and result.
The direct BY-274 implementation must conform to the exact physical schema defined by the release-baseline plan rather than copy the prerelease reviewer schema.
The separately authorized live cutover keeps the pre-merge source commit and uses its built or retained old executable only for exact merged-Change reconciliation.
It stores no compatibility fingerprint.
The domain-owned Task or Change representation stores the resolved reviewer configuration that Invocations and replacement continuations must use.

Create an Agent Session only when its domain role first invokes an agent.
The first dispatch transaction atomically creates the Agent Session, the domain-owned role link, and the first Invocation.
This avoids empty or orphan Agent Sessions.

Shared Agent infrastructure stores Agent Session and Invocation mechanics without Task IDs, Change IDs, or generic domain-operation fields.
Tasks and Changes store their own foreign-keyed links from domain operations to Agent Sessions and Invocations and own each role represented by those links.
Foreign keys ensure each link names an existing shared record.
Application operations enforce that one Agent Session belongs to only one domain owner and role because SQLite cannot express that exclusivity across separate Task and Change link tables without putting generic owner fields in shared Agent storage.
An Invocation has `created_at` and nullable `settled_at` timestamps rather than a duplicated settled-state field.
A missing `settled_at` means that its return is uncertain, including when interruption may have occurred before dispatch.
Task Review, Acceptance Review, Specialist Review, and Publication records remain with Tasks or Changes.
Shared Agent infrastructure stores only Agent Sessions, physical continuations, and Invocations.
Do not introduce a generic Review table or generic owner, workflow, run, phase, producer-registry, or plugin tables.

## Verification direction

Representative Task Review and Change reviewer behavior tests use a deterministic test Agent Harness through the supported domain operations.
Focused Pi Adapter tests verify assigned session IDs, resume arguments, and transcript discovery without calling a live model.
Recovery tests cover interruption, missing transcripts, correction Invocations, prevention of concurrent unsettled Invocations, and atomic Invocation and domain settlement.
Candidate Publication verifies its own later adoption if its accepted design still uses an agent.

## Accepted design direction

- Shared Agent infrastructure stores no generic owner fields; Tasks and Changes store their own Agent Session links.
- Dispatch is recorded before the harness call, the harness runs without an open database transaction, and Invocation evidence and the domain result settle atomically afterward.
- Invocation and transcript evidence is limited to the fields defined above, including `cacheRead` and `cacheWrite` token evidence; Invocation rows do not duplicate prompts or returned text.
- Review persistence remains domain-owned; shared Agent infrastructure contains no generic Review identity.
- Task Review inspection joins the Task-owned effective Task Reviewer configuration, and Validation Run inspection joins the relevant Change-owned reviewer configurations without copying configuration into each Review or Run.
- Use owner-role configuration, Agent Sessions, Agent Continuations, Agent Invocations, domain Tooling Failures, and cleanup evidence instead of the prerelease generic reviewer representation and aggregates.
- The direct BY-274 baseline conforms to this exact physical schema without importing or converting legacy Reviewer records.

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
