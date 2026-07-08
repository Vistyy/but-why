# Publish by to npm registry

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Publish the But Why? CLI package to the npm registry so users and agents can install or invoke `by` from the npm registry without needing a local tarball.

Issue 044 makes the package publish-ready and tarball-installable.
This issue chooses the registry release path and makes registry installation the supported public install path.

## Acceptance criteria

- [ ] The final npm package name or package scope is chosen and documented.
- [ ] `package.json` no longer blocks publishing with `private: true`.
- [ ] `by --version` reports the installed package version.
- [ ] The release process for versioning, packaging, and publishing is documented.
- [ ] npm authentication, access, and provenance requirements are documented or automated.
- [ ] The package is published to the npm registry.
- [ ] `docs/setup.md` documents stable registry-based install or invocation.
- [ ] `docs/setup.md` keeps tarball install only as a local development or release-verification path if still useful.
- [ ] Agent-facing install guidance references the stable registry install path after publishing.
- [ ] Existing `npm pack` verification remains part of release confidence.

## Out of scope

- Changing validation behavior.
- Agent-guided repository configuration of prepare, checks, reviewers, or profiles.
- Replacing the repo-local development CLI.
- Removing local tarball installation from the latest checkout as a development or release-verification path.

## Blocked by

- `docs/issues/044-package-by-as-installable-cli.md`
