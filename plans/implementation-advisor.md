---
status: provisional
artifact_kind: working-plan
remove_when: the approved implementation slices and Task Verification Contracts are recorded in SQLite Tasks and every cross-program handoff is recorded in its owning plan
---

# Implementation Advisor

> Non-authoritative working plan.
> This file records the operator-resolved design while the plan is under evaluation.
> SQLite Tasks will own approved implementation intent.

## Outcome

But Why must provide an optional visible Implementation Advisor during an Implementer's Interactive Session.

The Implementation Advisor must emit timely non-blocking advice without changing repository state, controlling the Implementer, or owning session continuation.

V1 is a visible advisory pilot.
It is not a silent shadow mechanism.

## Ownership

Implement the advisor as a project-specific Pi extension loaded only by the Implementer Agent Profile.

Bind one advisor to one parent Pi session.
But Why and Herdr bind that parent session to one Change and Managed Worktree.
Reusing the parent session for unrelated work is unsupported.

Keep `continue-change` as the sole liveness and continuation owner.
The advisor must not wake an idle Implementer.

## Advisor configuration

Repo Config and Global Config use `interactiveSession.implementationAdvisor.agentProfile` to select a separate Agent Profile.

Repo Config selection takes precedence over Global Config selection.

The advisor selection does not fall back to `defaultAgentProfile` or the Implementer Agent Profile.

The selected advisor profile supplies its model and thinking level independently from the parent Pi session.

The Implementer Agent Profile activates the advisor by including the packaged advisor extension.

A missing or invalid advisor selection disables the advisor with an operator-facing warning.
It does not block the Implementer.

## Observation and scheduling

Evaluate each completed `turn_end` delta that contains an `edit`, `write`, `bash`, failed tool, or read of supplied authority material.

Skip other read-only and discussion turns.

Allow only one advisor request at a time.

While a request is active, preserve every later qualifying delta.
After the active request completes, evaluate the accumulated deltas together.

If no rule is enabled, do not start advisor model activity.

## Exploration and output

Allow the advisor to use only `read`, `grep`, `find`, and `ls` within the Managed Worktree.

Do not give the advisor `bash`, network, edit, or write access.

Limit exploration to changed files, cited files, directly related files, and applicable authority documents.

Require one terminating TypeBox output tool.
The host must validate the output schema, rule ID, and cited evidence.

Return zero or one highest-priority advice note per evaluation.

Prioritize authority conflicts, uncertain external mutations, retired concepts, and verification mismatches in that order.

Suppress the same rule against the same cited evidence.
Permit the rule to advise again when a new violating action supplies new evidence.
Limit each rule to three emitted notes per Interactive Session.

## Delivery and failure

If the Implementer is active, deliver advice on its next model turn.

If the Implementer is idle, display and queue the advice without triggering a turn.

Do not interrupt generation or send a user message.

Advisor failure must remain fail-open.
Show one operator-facing warning and retry on the next qualifying turn.
Disable the advisor after three consecutive failures.
Reset the failure count after a successful evaluation.

## Initial rules

### `verification.proportional-evidence`

Evaluate only when verification is added, changed, or used to support a confidence claim.

Advise only when the evidence identifies a concrete Material Risk tied to an actual Verification Claim, changed verification evidence, or approved Task Verification Contract.

Missing branch coverage alone is not sufficient.

### `external-mutation.reconcile-before-retry`

Advise when an uncertain external mutation is retried or work proceeds without authoritative postcondition reconciliation.

### `current-system.remove-retired-concept`

Evaluate only when accepted intent explicitly replaces or removes a concept.

Inspect changed and directly related artifacts.
Do not apply a repository-wide lexical prohibition.

### `authority.explicit-conflict`

Evaluate only against applicable authority supplied to or discovered by the advisor.

Advise only when the proposed observable behavior explicitly conflicts with that authority and requires an Implementation Blocker.

## Spike evidence

The bounded spike in [implementation-advisor-spike.md](implementation-advisor-spike.md) supports the nested Pi session, separate model, read-only tools, structured output, and SDK-level non-waking delivery mechanisms.

All four positive semantic fixtures produced their expected rules with grounded citations.
One of four controls produced a verification false positive.
The narrower verification rule above is the approved response.

Actual Herdr rendering, production delta qualification, accumulated-delta scheduling, fail-open injection, and restart behavior remain implementation verification obligations.

## Program coordination

The advisor may be implemented before the verification portfolio migration.
Complete its Change and update the verification portfolio baseline before creating VP-0.

The codebase simplification audit does not block advisor implementation.
When that audit starts, it must treat the implemented advisor as current-system input and preserve separate advice and liveness ownership.

See [verification-portfolio-redesign.md](verification-portfolio-redesign.md) and [codebase-simplification-audit.md](codebase-simplification-audit.md) for the owning cross-program requirements.

## Session state and pilot telemetry

Persist the nested advisor conversation through Pi session storage.

Store the deterministic incident ledger as custom entries in the parent Pi session.

The ledger records the rule ID, evidence references and fingerprint, emitted or suppressed outcome, failure state, and timestamp.

Use the ledger for duplicate suppression, session caps, restart recovery, and pilot assessment.

Do not store model reasoning, copied file contents, or tool output in the ledger.

Do not add advisor state to But Why SQLite or structured CLI output.

The advisor is companion runtime behavior for an Implementer.
It is not a But Why persisted domain record.

## Task Verification Contract

### Material risks

- The advisor wakes, blocks, or mutates the Implementer's session.
- Scheduling drops qualifying deltas or creates concurrent evaluations.
- Invalid, stale, duplicate, or unsupported advice reaches the Implementer.
- Configuration couples the advisor to the Implementer model or grants unsafe tools.
- Advisor failure disrupts implementation or continuation.

### Required claims

- Advisor configuration resolves a separate Agent Profile with the approved precedence and no model fallback.
- The scheduler evaluates every qualifying delta with one active request and preserves all queued deltas.
- The advisor exposes only its bounded read-only tools.
- Only host-validated rule IDs, evidence references, and structured notes can reach the Implementer.
- Delivery does not wake an idle Implementer or take continuation ownership from `continue-change`.
- Failure remains fail-open and applies the approved warning, retry, disable, and reset behavior.
- Pi session state restores the deterministic ledger without But Why SQLite state.

### Required evidence

- Configuration tests establish separate Agent Profile resolution, precedence, no fallback, and fail-open misconfiguration.
- Extension tests at the Pi event seam establish qualification, serialization, complete queued-delta accumulation, delivery, duplicate suppression, caps, and failure handling.
- Structured-output tests establish schema, rule ID, and evidence-reference validation.
- Tool tests establish that only `read`, `grep`, `find`, and `ls` are available.
- Session tests establish deterministic ledger restoration without But Why persistence.
- Integration evidence establishes that idle advice does not start a model turn and `continue-change` remains the sole liveness owner.
- Package inspection establishes that the extension ships.
- The implementation must pass `just quality`.

### Escalation

- Amend the plan if Pi cannot queue visible advice without starting an idle turn.
- Amend the plan if the separate Agent Profile cannot reach the nested session without weakening the Implementer resource allowlist.
- Amend the plan if bounded read-only tools cannot be enforced at the nested-session seam.

### Not required

- Do not add a durable real-model test.
- Do not claim that model advice is semantically correct.
- Do not add But Why SQLite migrations or structured CLI output.
- Do not support a future background Implementer in v1.

The spike remains one-time feasibility evidence.
Pilot telemetry evaluates semantic quality.

## Reviewer context prerequisite

Before the advisor implementation, make Acceptance Context available to every Specialist Reviewer for a task-backed Change.

### Acceptance Review role

Acceptance Review uses Acceptance Context as review authority and owns overall conformance judgment.

It judges required behavior, completeness, correctness, and the Task Verification Contract.

It may require missing work necessary to satisfy approved intent.

It must not expand approved intent, require optional improvement, or repeat a configured Specialist concern unless that concern affects acceptance.

### Specialist Review role

Specialist Review uses Acceptance Context only as an authoritative scope constraint while judging its configured concern.

It reports only material concern-specific defects that are worth blocking the Candidate.

A Standards Specialist may report concrete maintainability, architecture, documentation, unnecessary-complexity, or existing-test-quality defects.

A Specialist may report existing verification evidence that is wrong, broken, brittle, disproportionately costly, or misleading within its configured concern.

It must not own overall acceptance, expand Task intent, review unrelated concerns, demand verification beyond the Task Verification Contract, argue against an approved verification decision, or report optional improvements.

Taskless Specialist Review receives no Acceptance Context.

The reviewer-context work must update initial and continuing prompts, Validation policy and orchestration, applicable Reviewer Session continuity, domain definitions, and verification evidence.

Record this work as a separate prerequisite Task because it provides independent review behavior and changes every task-backed Specialist.

A read-only audit of 648 historical Findings found 79 Specialist Findings, seven cross-role duplicate concern groups, and one clear Specialist verification overreach.
The BY-50 Standards Findings required behavior and tests that its approved Resolution explicitly excluded.
This evidence establishes that the reviewer responsibility boundary needs explicit prompt enforcement.

## Open decisions

The plan must resolve whether the general multi-agent role-contract rule belongs in the shared `writing-instructions` skill.
