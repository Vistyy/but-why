# Implementation Unit planning exploration

**Status:** Deferred planning exploration.
This file is not implementation authority, accepted product behavior, or a source of truth for the current system.

**Revisit condition:** Reassess this direction after the first-release SQLite baseline and operational cutover are complete.
Remove this file if the later assessment rejects Implementation Units or after accepted behavior is implemented and recorded in current authority.

## Problem

Large Tasks can produce implementation and review scopes that exceed reliable agent attention even when the Task represents one coherent end-to-end outcome.
The historical BY-269 replay suggested that scoped reviews can find defects missed by an individual monolithic review, but the replay did not implement or validate a real iterative Unit lifecycle.

## Candidate direction

A Change can own an ordered set of durable Implementation Units proposed by the Implementer during an initial implementation-planning phase.
The Unit plan would be non-authoritative execution guidance derived from the Change's current Acceptance Context when one exists, current repository evidence, and the Implementer's technical judgment.
It would not become part of the Task, Task Context, Acceptance Context, or approved intent.
The Implementer could revise the Unit plan as implementation reveals new technical information without changing accepted intent.

Each ordinary Implementation Unit would define one bounded implementation outcome without replacing or weakening the complete Acceptance Context.
A Change could have no ordinary Implementation Units.
The system would append one Integration Unit after the initial Unit plan rather than relying on an agent to remember it.
The Integration Unit would derive its fixed responsibility from the complete current Acceptance Context when one exists, ordered Unit plan, recorded Unit evidence, and current assembled code rather than duplicating accepted intent as editable prose.

Change execution could use one Managed Worktree and Repository Branch.
Each Unit would capture an exact predecessor commit and resulting head commit so review can inspect the complete tree at the head while focusing on the Unit delta.
A completed Unit checkpoint would authorize advancement only and would not authorize publication or claim that the complete Acceptance Context is satisfied.
A later Unit could modify earlier code, but that later delta would require review again.
A Change without a Task could use Units to organize implementation, but its Unit plan would not create Acceptance Context or other approval authority.

Unit submission and final Change Submission could share Snapshot Workspace preparation, deterministic Checks, Acceptance Reviewer execution, Specialist Reviewer execution, Artifact handling, Agent Invocation mechanics, and settlement mechanics.
Unit Validation would judge the current non-authoritative Unit focus while receiving the complete current Acceptance Context as authority when one exists, and it would record evidence before advancing to the next Unit.
Final Change Validation would judge the complete Candidate against the complete Acceptance Context when one exists, reconcile cross-Unit interactions, and remain the only validation that can authorize publication.

Reviewer Agent Sessions should be reused from the first Unit through final validation by default.
Each Invocation must receive the complete current review subject and exact commit boundary rather than relying on conversation memory.
A fresh Agent Continuation should remain recovery for an unusable continuation, not the normal Unit boundary.
Fresh sessions per Unit require evidence that their quality gain justifies repeated repository orientation, elapsed time, and uncached token cost.

## Provisional execution shape

```text
Change Start
  capture the approved Task as Acceptance Context when linked

Implementation planning
  Implementer proposes zero or more ordinary Implementation Units
  append the system Integration Unit
  record the non-authoritative Change-owned Unit plan

Change execution
  implement current Unit
  capture exact Unit checkpoint
  run scoped validation with the existing reviewer roster
  correct Findings or advance
  repeat through ordinary Units
  implement the Integration Unit
  run complete Change Validation
  publish only the final Candidate
```

## Required later evidence

Before selecting a session policy or durable schema, run one cumulative historical replay with a fixed recorded Unit plan.
Compare one continuing reviewer Agent Session with fresh reviewer sessions while holding the model, prompts, commit boundaries, and reviewer responsibility constant.
Measure material Finding recall, unsupported Findings, escaped final defects, correction rounds, elapsed time, and exact Invocation token evidence.

The replay must apply corrections before advancing and finish with a complete integration judgment.
A path-filtered review simulation without cumulative valid repository state is insufficient evidence.

## Unresolved design decisions

- The exact Change-owned Unit plan, checkpoint, Unit Validation, Finding, and recovery records.
- How the Implementer records and revises a Unit plan without creating approval authority.
- How an approved Implementation Blocker Resolution and resulting Acceptance Context version affect the current Unit plan.
- Which final reviewers may rely on immutable Unit evidence and which complete-state observations they must repeat.
- Whether every Unit must run all deterministic Checks or whether current repository contracts can select a smaller sufficient set.
- The supported CLI operations for Unit capture, validation, correction, advancement, and inspection.
- The cost and quality threshold that would justify a fresh reviewer Agent Session policy.

## Exclusions

This exploration does not authorize current Task, Change, Candidate, Validation Run, Agent Session, migration, CLI, or publication behavior changes.
It does not require stacked branches, intermediate pull requests, a new generic reviewer personality, a generic workflow engine, or speculative baseline tables.

## Authorization status

No implementation, Task Recording, Task Submission, Change Start, or migration is authorized by this plan.
