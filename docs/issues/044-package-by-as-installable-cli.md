# Package by as an installable CLI

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Make `by` installable and usable outside this source checkout.

Today `by` is mainly a project-local wrapper under `bin/`.
A normal user or agent should be able to install it, run it from another repo, and use it without depending on this repo's source tree or local `node_modules` layout.

## Acceptance criteria

- [ ] `by` can be installed for use from another repository.
- [ ] The installed CLI runs without relying on `src/main.ts` at runtime.
- [ ] The installed CLI runs without relying on `tsx` as a runtime loader.
- [ ] The package build emits a stable runtime entrypoint.
- [ ] `package.json` points `bin.by` at the stable runtime entrypoint or a wrapper for it.
- [ ] The development workflow still supports running `by` from this repo.
- [ ] A smoke test installs or links the package into a temp location and runs `by --help` from a separate Git repo.
- [ ] A smoke test runs `by init --task-prefix BY` from a separate Git repo through the installed CLI.
- [ ] Install instructions are documented in `docs/setup.md`.
- [ ] Agent-facing install guidance is documented or made ready for issue 041.
- [ ] Packaging does not publish to a registry unless a later issue explicitly chooses that release path.

## Blocked by

None.
