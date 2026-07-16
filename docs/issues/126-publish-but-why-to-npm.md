# Publish But Why? to npm

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/issues/125-produce-installable-v1-package.md`

## Behaviors owned

- The verified unscoped `but-why` package is publicly installable with provenance.

## What to build

Publish the exact verified package candidate through npm trusted publishing and confirm installation from the public registry.

## Primary verification seam

Clean-repository installation from npm followed by the installed CLI smoke suite.

## Acceptance criteria

- [ ] Trusted publishing uses the verified source and package candidate without a long-lived npm token.
- [ ] npm provenance identifies the release source and workflow.
- [ ] The public package name, version, executable, files, and metadata match the verified candidate.
- [ ] A clean local and global installation can run help, init, and the documented setup path.
- [ ] Publication failure is recoverable without publishing a different artifact under the same version.
- [ ] Release notes point to the supported manual v1 workflow and its explicit deferred capabilities.

## Blocked by

- `docs/issues/125-produce-installable-v1-package.md`
