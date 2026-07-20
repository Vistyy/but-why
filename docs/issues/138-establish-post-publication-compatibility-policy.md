# Establish post-publication compatibility policy

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/issues/137-move-state-storage-to-effect-sql.md`
- `AGENTS.md`

## Behaviors owned

- The first public package publication establishes the compatibility boundary for installed users.
- Repository guidance distinguishes internal cleanup from changes to persisted state and public interfaces.
- The temporary unreleased-schema instruction retires after publication.

## What to build

After the first public npm publication succeeds, replace the temporary schema guidance with a compatibility policy for persisted state and public interfaces.
Keep current domain language as the naming standard while requiring an explicit migration, deprecation, or release decision for breaking published contracts.

## Primary verification seam

Documentation consistency audit after the published package installs successfully from the public registry.

## Acceptance criteria

- [ ] `AGENTS.md` no longer describes the repository as unreleased or names Task 137 as future work.
- [ ] Contributor guidance identifies persisted data and installed CLI interfaces as compatibility boundaries.
- [ ] Internal code, storage, and documentation continue to use current domain language.
- [ ] Breaking a published contract requires an explicit migration, deprecation, or release decision.
- [ ] Historical planning documents remain historical evidence rather than current compatibility obligations.
- [ ] Internal and shipped documentation state one consistent compatibility policy.

## Blocked by

- `docs/issues/126-publish-but-why-to-npm.md`
