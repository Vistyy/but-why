# But Why?

But Why? is an unreleased, task-based validation system for agent-assisted code changes.

CLI: `by`.

But Why? keeps Task intent and lifecycle separate from Change-owned implementation, validation, delivery, and pull request state.
A Change can link to an approved Task or remain taskless.

It prepares Managed Worktrees, validates committed Candidates, and publishes eligible Changes through GitHub pull requests.

Follow [`docs/public/setup.md`](docs/public/setup.md) for installation and setup.
