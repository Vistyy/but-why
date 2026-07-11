# Register and launch repository workers

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Install a thin user-level Supervisor through setup, register repositories explicitly, and launch an isolated repository worker when durable work needs attention.
Repository state, policy, Git, and execution authority remain inside the worker.

## Acceptance criteria

- [ ] The first `by init` installs the Supervisor and registers the repository by default.
- [ ] `by init --no-automation` skips both installation and registration.
- [ ] Other commands never install the Supervisor or register a repository implicitly.
- [ ] Repository registration uses canonical Git common-directory identity and is explicit and idempotent.
- [ ] A durable wake starts the selected repository runtime and isolated worker on demand.
- [ ] Supervisor and worker use a versioned protocol and reject incompatible runtime versions with a concrete recovery action.
- [ ] The worker reads its own repository policy and durable state after launch.
- [ ] The Supervisor never reads repository Tasks, Changes, policy, SQLite state, or Git facts.
- [ ] Registration, startup, disabled automation, missing runtime, and incompatible runtime have structured inspectable outcomes.

## Blocked by

- `docs/issues/064-pick-up-afk-tasks-in-repository-workers.md`
