---
status: accepted
---

# Use Change as the validation and delivery owner

But Why? uses Change as the durable ownership center for code lineage, managed Task worktrees, Candidates, Validation Runs, Findings, and PR identity.
A Task owns approved intent, direct dependencies, and projected user-facing progress.
V1 creates Changes only for started Tasks, while the ownership model may support other entry points later without moving validation state back onto Task.

## Considered Options

- Keep validation and delivery owned by Task.
- Introduce a generic workflow owner.
- Make Change the owner and link Task Acceptance Context.

## Consequences

- A Task has at most one Change, and a Change has at most one linked Task.
- A repository branch binds at most one Change.
- Change and Candidate records use permanent opaque IDs.
- A Candidate identifies one immutable comparison-base and head pair within its Change.
- Validation Runs belong to Candidates and use Task-derived Acceptance Context.
- The Validation Gate remains read-only.
- `by submit <task-id>` validates and publishes the exact eligible Candidate.
- Task status projects approval and active Change facts rather than authorizing validation phases.
- Existing Task-owned validation and delivery migrate through expand, migrate, and contract stages.
- `docs/architecture.md` continues to describe the implemented system until that migration completes.
