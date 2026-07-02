---
status: accepted
---

# Use Sandcastle as the v1 execution engine

Sandcastle is the v1 execution engine for validation worktrees, sandboxes, command execution, agent execution, logs, structured output retries, and token usage.
But Why? should embed Sandcastle through thin domain seams instead of reimplementing those execution concerns.
The Sandcastle spike proved the required validation workspace behavior for issue 011.

## Considered Options

- Build custom execution plumbing inside But Why?.
- Hide Sandcastle behind a thick generic execution provider.
- Use Sandcastle directly behind thin But Why? domain seams.

## Consequences

Production validation code may now depend on Sandcastle.
Sandcastle owns validation worktree creation, sandbox lifecycle, command execution, agent execution, logs, structured output retries, and token usage.
But Why? owns Run-scoped temp validation refs and Run-scoped tooling error diagnostics because Sandcastle takes a branch or ref as input and does not own But Why? Run state.
But Why? should keep its execution seams domain-specific and should not grow a custom replacement by accident.
