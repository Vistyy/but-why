# Recover and govern repository workers

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Make Supervisor and repository worker operation reliable across lost wakes, process crashes, idle periods, multiple repositories, and GitHub waiting.
Keep all workflow decisions in repository workers while the Supervisor manages process capacity and health.

## Acceptance criteria

- [ ] Startup and low-frequency worker reconciliation recover eligible or interrupted work after lost wakes or crashes.
- [ ] Workers may exit after an idle period and restart without losing durable progress.
- [ ] User-wide capacity prevents one repository from starving another.
- [ ] Waiting for GitHub releases active coding capacity.
- [ ] Worker crashes, restart exhaustion, registration problems, and health state are inspectable.
- [ ] Reconciliation cannot create duplicate Change ownership, validation, implementation, or publication work.
- [ ] One unhealthy repository cannot crash or block unrelated repository workers.

## Blocked by

- `docs/issues/062-reconcile-pr-facts-and-later-heads.md`
- `docs/issues/065-register-and-launch-repository-workers.md`
