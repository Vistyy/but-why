# Task navigation and inspection experience plan

**Status:** Active exploration in the current Operator-directed session.
This file records evidence, settled direction, current recommendations, and unresolved decisions.
It is not an approved specification or implementation authority.
It remains subordinate to the product boundaries under exploration in `plans/task-change-boundary.md`.

**Removal condition:** Remove this file after the Operator accepts or rejects the redesign and every accepted outcome is recorded in the smallest applicable authoritative work record, current documentation source, or ADR.

## Purpose

Design an agent-first read experience for navigating large Task collections without requiring agents to retrieve the complete Task inventory and reconstruct operational state through repeated Task and Change inspection.

The design covers:

- Exact Task lookup and complete Task Context inspection.
- Repository-wide work selection and progress inspection.
- Task Dependency navigation.
- Text discovery of existing Tasks.
- Bounded Task inventory and history browsing.
- No-argument CLI behavior.

The design does not authorize implementation.

## Settled direction

Remove the current bare `by` dashboard.
A future bare `by` may become a human-facing terminal UI, but that interface is not part of this redesign.
Until then, bare `by` should not present the current incomplete live-state dashboard.

Keep the CLI agent-first, non-interactive, and repository-scoped.
Structured stdout remains JSON under the accepted CLI output policy.

Do not treat this work as a help-text cleanup, a new `--search` option, or an extension of the current full-inventory workflow.
The current interface is inefficient because one storage-oriented collection operation is being used to answer several materially different questions.

Keep Task Lifecycle limited to New, Todo, Done, and Cancelled.
Do not persist `startable`, `waiting`, `active`, `blocked`, or `ready` as additional Task states.

Preserve the distinction between Task Lifecycle, Task Dependency readiness, Task Review activity, and Change Activity.
Change Activity remains the canonical derived classification of a linked Open Change as `implementing`, `validating`, `blocked`, or `ready`.

Keep text discovery distinct from Task Dependency navigation.
A text match does not establish a Task Dependency or another domain relationship.

Keep complete Task Context in a focused detail operation rather than returning it by default in collections.

## Current system

`by task list` currently combines lifecycle scope and output bounds through `--all`, `--state`, and `--limit`.
The default limit is five.
`--all` includes terminal Tasks, while `--limit all` removes the output bound.
This gives the word `all` two unrelated meanings.

The default list includes New and Todo Tasks in oldest-first order.
The list returns Task identity, title, lifecycle state, timestamps, unfinished direct prerequisites as `blockedBy`, and a linked Change projection.
The underlying Task summary also computes `startable`, but Task List omits it.
Satisfied Task Dependency edges are omitted from Task List because `blockedBy` contains only unfinished prerequisites.

`by task show <task-id>` returns one Task's lifecycle facts, direct prerequisites, direct dependents, linked Change projection, latest Task Review summary, and contextual next commands.
`by task context <task-id>` returns the complete current Task title and description.

The current bare `by` dashboard reads all New and Todo Tasks through an internally named actionable collection.
It does not distinguish reviewable, startable, waiting, or Change-linked work.

## Usage evidence

A reproducible transcript study inspected Pi session headers from July 28 through August 12, 2026.
The corpus contained 494 sessions, of which 321 contained an in-scope Task invocation or Change Start invocation for a Change linked to a Task.
The study parsed assistant `bash` and `bg_run` tool calls and did not treat user text, injected prompts, documentation examples, or tool output as command execution.

Observed use included:

- 272 Task List invocations across 94 sessions.
- 698 Task Show invocations across 113 sessions.
- 1,200 Task Context invocations across 306 sessions.
- 559 Task help invocations across 174 sessions.
- 152 Task Create invocations across 59 sessions.
- 20 Task Submit invocations across 6 sessions.
- 40 Task Dependency mutation invocations across 26 sessions.
- 159 Change Start invocations for Changes linked to a Task.

Task List was post-processed through a pipeline, redirection, or command substitution in 79 of 272 invocations.
Common processors included `head`, `jq`, `rg`, `grep`, and Python scripts.

Repeated exact normalized commands occurred in 164 sessions.
Beyond the first identical invocation in a session, the study observed 89 repeated Task List calls, 271 repeated Task Show calls, and 417 repeated Task Context calls.
A repeat can be a justified state refresh or intent reread, so these counts do not by themselves identify defects.

Observed operational sequences repeatedly combined broad collections and focused inspection, for example:

```text
Task List for New work
Task List for Todo work
Change List
Task Show for several candidate Tasks
Task Context for selected Tasks
Task Submit or Change Start
Reconcile Changes
Repeat the lists and focused inspections
```

Other sessions retrieved the complete Task inventory, searched it locally for related wording, and then called Task Show and Task Context for each candidate.
Dependency planning sessions reconstructed a Task Dependency graph through several individual Task Show calls because no collection exposes complete direct edges or transitive traversal.

Managed Worktree sessions behaved differently from repository-level planning sessions.
They normally began with a known Task ID and repeatedly read that Task's Context to re-establish accepted intent during implementation.
This evidence supports preserving efficient exact inspection rather than trying to solve every job through a repository-wide view.

The extraction excluded direct Node entrypoints, variable-held commands that could not be resolved, external terminals, deleted sessions, and sibling transcript stores.
The CLI changed during the observation window, so some help usage and failures refer to retired command forms.
The study establishes recurring jobs and round trips, but it does not by itself select final command names or schemas.

## Distinct agent jobs

### Inspect one known Task

The agent knows a Task ID and needs its lifecycle, relationships, Review state, linked Change state, complete intent, or next valid operation.

This job should remain centered on exact lookup:

```text
by task show <task-id>
by task context <task-id>
```

Task Show should remain concise enough for repeated inspection.
Task Context should remain the complete intent read.
The design must determine whether any facts now split between these commands cause avoidable calls without making complete Context part of normal summary output.

### Select or resume work

The agent needs to understand unfinished work across the repository.
Typical questions are:

- Which New Tasks can be submitted for Task Review?
- Which New Tasks already have an Active Task Review?
- Which Todo Tasks can start a Change now?
- Which Todo Tasks are waiting for unfinished prerequisites?
- Which Tasks already have Open Changes?
- What is each linked Change's current Change Activity?
- What became startable after reconciliation?
- Which work can proceed independently without implying a priority order?

The current system requires several Task List, Change List, and Task Show calls to answer these questions.
This job needs an explicit operational projection rather than a full inventory.

### Navigate Task Dependencies

The agent knows one Task or a bounded set of roots and needs to understand actual prerequisite relationships.
Typical questions are:

- What directly blocks this Task?
- Which Tasks directly depend on this Task?
- Which prerequisite edges remain unsatisfied?
- What is the relevant transitive prerequisite or dependent chain?
- Why is a set of Tasks necessarily sequential?

This job needs relationship traversal based only on recorded Task Dependencies.
It must not infer relationships from text similarity, shared files, likely conflicts, or preferred sequencing.

### Discover existing work by text

The agent needs to find a Task without knowing its ID or determine whether related work has already been recorded.
Typical queries use words from a title, Task Context, subsystem, or intended outcome.

This job needs text discovery that reports matches as matches.
The design has not established searchable fields, ranking, tie-breaking, lifecycle filtering, or continuation behavior.

### Browse inventory and history

The agent needs deterministic access to Tasks in selected lifecycle states for audit, historical investigation, or bulk processing.
This is the appropriate responsibility for a bounded Task List.
Done and Cancelled Tasks should not dominate normal work selection.

## Current interface recommendation

This section is a recommendation for further decision, not settled behavior.

### Exact inspection

Keep Task Show and Task Context as separate focused operations.

Task Show should expose the smallest complete operational summary for one Task, including:

- Task identity, title, lifecycle state, and timestamps.
- Direct prerequisites and direct dependents with their lifecycle states.
- Whether a Todo Task has all prerequisites Done.
- Latest Task Review state and outcome when present.
- Linked Change identity and canonical Change Activity when present.
- Commands valid for the returned state when another action is available.

Task Context should expose complete Task Context without truncation or unrelated workflow history.

### Repository-wide operational projection

Add one explicitly named read operation that answers what can happen next across unfinished Tasks.
It should replace the repeated combination of New Task List, Todo Task List, Change List, and several Task Show calls.

The current proposed projection contains separate collections for:

- New Tasks, including Active Task Review facts needed to distinguish submit, inspect, and wait decisions.
- Startable Todo Tasks whose direct prerequisites are Done and which have no linked Open Change.
- Todo Tasks without a linked Open Change that are waiting for unfinished direct prerequisites.
- Tasks with linked Open Changes, including Change identity and canonical Change Activity.

This projection should not:

- Include Done or Cancelled history by default.
- Include complete Task Context.
- Perform text search.
- Return the complete Task Dependency graph.
- Rank Tasks or imply that one startable Task has priority over another.
- Rename Change Activity as Task state.
- Replace exact Task inspection.

The existence and responsibility of this projection are not yet accepted.
Its command name must not be selected until the Operator confirms that the projection itself matches the required job.

### Dependency navigation

Add a relationship-focused read operation for a selected Task or bounded roots.

The operation should support direct relationships by default and an explicit transitive expansion when required.
Each returned Task should include identity, title, lifecycle state, and the exact edges that caused its inclusion.
The output must distinguish prerequisites from dependents and satisfied edges from unfinished edges.

Repository-wide graph output should require explicit expansion rather than be the default response.
The design has not established traversal direction syntax, depth controls, ordering, cycle-proof output representation, or size limits.

### Text discovery

Add a separate Task search operation only after resolving the evidence-backed search contract.

The design must determine:

- Whether title and complete Task Context are both searchable.
- Whether matching is lexical, relevance-ranked, or another defined method.
- How lifecycle filters interact with search.
- How deterministic tie-breaking works.
- How bounded results continue.
- Which match evidence helps an agent choose a Task without returning excessive Context.

Search output must not label matches as dependencies or otherwise imply a domain relationship.

### Bounded inventory

Retain Task List for deterministic lifecycle browsing and history.

The redesigned list should:

- Use explicit lifecycle selection rather than `--all` as a second scope concept.
- Use a numeric default bound suitable for observed repository sizes.
- Report returned count and total matching count.
- Provide deterministic continuation rather than recommending an unbounded complete inventory.
- Include only fields needed to identify records and choose an exact follow-up inspection.
- State an empty successful result explicitly.

The design has not established the default bound, ordering, cursor representation, or whether complete unbounded retrieval remains supported.

### No-argument behavior

Remove the current live-state handler from bare `by`.

Until a future human-facing terminal UI exists, the current recommendation is for bare `by` to return concise structured command-discovery guidance without opening Shared Repository State.
The exact result schema and relationship to `by --help` remain unresolved.

The behavior of bare `by task` also remains unresolved.
It may return focused Task command guidance or invoke the operational projection, but this decision should follow acceptance of that projection.

## Ownership and structure

Task Intent owns Task Lifecycle, Task Review facts, Task Dependencies, readiness derived from Task facts, and Task-owned read models.
Change Delivery owns Change Activity and Change inspection facts.

A combined Task operational projection crosses those facts.
Under the boundary currently explored in `plans/task-change-boundary.md`, Task and Change coordination should join supported Task and Change projections for CLI output.
It should not store Change Activity on Tasks, reproduce Change derivation rules, or let Task persistence query Change-owned tables through an undocumented seam.

CLI modules should select the applicable read operation and translate its result.
They should not coordinate persistence or derive domain state from raw records.
The output boundary should continue to own JSON serialization.

The implementation design must trace one representative operational query through the Task, Change, coordination, CLI, and output boundaries after the Task and Change boundary is accepted.

## Verification direction

Observable CLI behavior must be verified through supported commands rather than only through persistence calls.

The eventual verification should establish at least these material claims:

- Exact Task lookup remains efficient and complete for its defined summary contract.
- Complete Task Context remains available without collection expansion.
- The operational projection distinguishes New, startable, prerequisite-waiting, and Change-linked Tasks from authoritative facts.
- Canonical Change Activity is preserved without becoming Task Lifecycle.
- Dependency traversal returns only recorded Task Dependency edges in the requested direction and scope.
- Text search does not represent matches as dependencies.
- Bounded inventory reports deterministic counts and continuation.
- Bare `by` no longer opens or renders the current dashboard.
- Errors and empty collections remain structured JSON with applicable recovery guidance.

Use representative CLI observations and focused durable coverage where each can reveal a material regression.
Do not preserve tests or package files whose only purpose is the retired dashboard.

## Planning sequence

1. Confirm or reject the repository-wide operational projection as a distinct read job.
2. Define its exact categories from Task Lifecycle, Task Review, Task Dependencies, and Change Activity without introducing new lifecycle state.
3. Select its command location and smallest output schema.
4. Define exact Task Show responsibility relative to complete Task Context.
5. Define direct and transitive Task Dependency navigation, ordering, bounds, and output representation.
6. Decide whether current evidence requires text search in the first redesign.
7. Define bounded Task List lifecycle selection, ordering, default limit, and continuation.
8. Define bare `by` and bare `by task` behavior after removing the dashboard.
9. Reconcile every combined read operation with the accepted Task and Change boundary.
10. Record accepted outcomes as Tasks only after Task Recording Authorization.
11. Implement only after explicit Implementation Authorization through the selected work route.

## Unresolved decisions

- Whether one repository-wide operational projection is the correct replacement for repeated New, Todo, Change, and exact inspection calls.
- The public name and command location of that projection if accepted.
- Whether New Tasks with an Active Task Review belong in the same projection and which facts distinguish their next actions.
- Whether Todo Tasks with a linked Closed Change require a separate exceptional category or are handled through reconciliation and data validation.
- Default ordering within each operational collection without implying priority.
- Default bounds and continuation for operational collections.
- Task Show fields and whether concise Task Context previews have evidence-backed value.
- Dependency traversal syntax, direction, depth, ordering, and limits.
- Whether text search is required in the first redesign.
- Search fields, matching method, ranking, tie-breaking, filtering, and continuation.
- Task List lifecycle selection, ordering, default limit, and support for complete retrieval.
- Bare `by` and bare `by task` structured behavior.

## Authorization status

This plan records investigation and current recommendations only.
It does not authorize Task Recording, Task Submission, Change Start, implementation, or edits to current product documentation and domain contexts.
