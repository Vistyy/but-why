# Package by as an installable CLI

## Status

Historical completion record.
The current product defers package execution until npm publication provides the supported `pnpx` path.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Make `by` installable and usable outside this source checkout.

Today `by` is mainly a project-local wrapper under `bin/`.
A normal user or agent should be able to install it from a local `npm pack` tarball, run it from another repo, and use it without depending on this repo's source tree or local `node_modules` layout.
The same local tarball should support global installation from the latest local checkout without publishing to the npm registry.

Use `just by ...` or the repo-local CLI when developing But Why? itself.
Use the Installed CLI, invoked as `by ...`, when using But Why? from another repository.

## Acceptance criteria

- [x] `by` can be installed from an `npm pack` tarball for use from another repository.
- [x] The same local tarball can be installed globally from the latest local checkout and run as `by`.
- [x] The installed CLI runs without relying on `src/main.ts` at runtime.
- [x] The installed CLI runs without relying on `tsx` as a runtime loader.
- [x] The package build uses plain `tsc` TypeScript emit and emits `dist/main.js` as the stable JavaScript runtime entrypoint.
- [x] `package.json` includes a build script for the TypeScript emit.
- [x] `package.json` includes a `prepack` script so `npm pack` builds `dist/main.js` before creating the tarball.
- [x] `package.json` declares the Node 24 runtime requirement through `engines.node`.
- [x] `package.json` points `bin.by` at `dist/main.js`, not a shell wrapper.
- [x] Packaging does not introduce a bundler for this issue.
- [x] `package.json` uses a narrow `files` allowlist for package contents.
- [x] The package ships built output and user-facing package metadata only, not `src/`, tests, spikes, or repo-local tooling.
- [x] Smoke tests or package assertions verify the packed package does not include `src/`, tests, or spikes.
- [x] The development workflow still supports running `by` from this repo through `just by ...` or an equivalent repo-local CLI path.
- [x] The repo-local CLI may remain source-based for development, including use of `tsx`, as long as the Installed CLI does not depend on it.
- [x] A smoke test installs the `npm pack` tarball as a project-local dependency in a temp Git repo and runs `by --help` through that repo's local installed bin.
- [x] A separate install check proves the same tarball can be installed globally from the latest local checkout and run as `by`.
- [x] Installed CLI help smoke tests assert successful help output, not a repo-local `bin` path.
- [x] A smoke test runs `by init --task-prefix BY` from a separate temp Git repo through that repo's local installed bin.
- [x] Smoke tests remain project-local and do not require global package installation.
- [x] Tarball-only install instructions are documented in `docs/setup.md`, including global installation from the latest local checkout tarball.
- [x] `docs/setup.md` says npm registry install is not available until issue 046 publishes the package.
- [x] Agent-facing install guidance is documented or made ready for issue 041.
- [x] Agent-guided repository configuration of `validation.prepare`, `checks`, and reviewer/profile policy is out of scope for this issue and belongs to issue 043 or a follow-up setup issue.
- [x] Packaging is publish-ready but does not publish to a registry; issue 046 owns the npm registry release path.
- [x] `by --version` is out of scope for this issue and belongs to issue 046.
- [x] Cleanup of whether `by --help` should include a `bin` field is out of scope for this issue.
- [x] `package.json` remains private for this issue unless issue 046 removes that guard.

## Blocked by

None.
