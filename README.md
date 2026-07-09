# But Why?

Work-in-progress validation system for agent-assisted code changes.

CLI: `by`.

Current direction:

- manage repo-scoped tasks for agent-assisted code work
- validate submitted branches against task intent
- use Sandcastle for execution, agents, checks, logs, retries, and token usage
- publish only validated changes through GitHub PRs
- keep custom code focused on tasks, runs, findings, PR readiness, and policy

Nothing is stable yet.

## Agent-assisted setup

Give this prompt to an agent:

```text
Install But Why for this repository.
Follow docs/public/setup.md in this repository.
Before installing the agent skill, detect my existing skill conventions and ask where to place it.
```
