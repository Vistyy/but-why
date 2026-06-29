---
status: proposed
---

# Use Sandcastle as the v1 execution engine

Sandcastle is the intended v1 execution engine for validation worktrees, sandboxes, command execution, agent execution, logs, structured output retries, and token usage.
But Why? should embed Sandcastle through thin domain seams instead of reimplementing those execution concerns.
This decision remains proposed until the Sandcastle spike proves the required behavior.

## Considered Options

- Build custom execution plumbing inside But Why?.
- Hide Sandcastle behind a thick generic execution provider.
- Use Sandcastle directly behind thin But Why? domain seams.

## Consequences

The first implementation slice must prove Sandcastle before core implementation depends on it.
If the spike fails, the v1 execution plan should change before But Why? grows a custom replacement by accident.
