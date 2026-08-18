# First-release readiness plan

**Status:** Paused pending the product and package boundary.
Release operations may remain applicable after the Task Intent extraction is resolved.
Do not use this plan as current planning direction, implementation authority, or publication authority.

**Removal condition:** Remove this file after all repository outcomes are implemented and documented, all release operations are completed, and any remaining supported procedure is recorded in its authoritative documentation.

## Release outcome

But Why will have a first stable public release identified as `0.1.0`.
The npm package remains `but-why` and the executable remains `by`.
The package will use the normal `latest` distribution tag and will be published manually after verification of the exact artifact.

## Installation

The normal installation path is global npm installation.
Published operation resolves `by` from `PATH`.
The public workflow does not use `pnpx`, `pnpm dlx`, or `npx`.
Source-repository development uses an installed package build for live repository operations and disposable repositories for Candidate tests.

The CLI will provide an explicit Pi integration setup operation, provisionally named `by setup pi`.
Setup connects Pi to resources in the same globally installed But Why package rather than installing an independently updated resource package.
Setup must be explicit, idempotent, and able to repair a stale installed-package path.
A normal global package update updates the CLI, skill, instructions, and continuation extension as one release unit.

## Pi resources

The But Why skill is a normal Pi resource for Operator sessions.
The `continue-change` extension remains a packaged runtime asset owned by But Why.
It must not be globally active in ordinary Operator or Reviewer sessions.
The Interactive Session Host loads it explicitly only for an Implementer Interactive Session.
The extension, CLI contracts, and packaged Implementer instructions remain version-aligned.

The exact supported Pi registration mechanism, setup output, no-op behavior, stale-path repair, missing-Pi behavior, interruption reconciliation, and removal behavior remain unresolved.

## Package and licensing

The project will use the MIT license with copyright holder `Vistyy`.
But Why will retain Pi-style JavaScript source maps with embedded source content.
It will not ship the raw implementation source tree solely for source-map support.

No transient dependency override will be added solely to replace Pi's current vulnerable `brace-expansion` resolution.
Reassess the advisory before release and report it accurately if it remains.

The public `by --version` contract, package-version source, and supported upgrade procedure remain unresolved.

## Public product interface

`README.md` becomes the public product entry point.
It must explain the product purpose, package and command names, prerequisites, installation, Pi integration setup, initialization, supported workflow, and upgrades.
Public and packaged guidance must use the implemented installed-product interface.
Remove unreleased package-runner guidance only when its supported replacement exists.

Add a concise `CONTRIBUTING.md` that points to the repository's existing contributor instructions and `just quality` without duplicating architecture or tooling documentation.
Add a minimal factual `SECURITY.md` only after the supported reporting channel is selected.
The preferred reporting mechanism is GitHub Private Vulnerability Reporting without an unsupported response-time promise or unmonitored email address.

A code of conduct, issue templates, pull request template, and `SUPPORT.md` are not currently required.

## Repository positioning

The working repository description is: "But Why is a deterministic workflow for turning approved repository work into validated agent-assisted Changes."
Candidate topics are `ai-agents`, `coding-agents`, `developer-tools`, `task-management`, `code-validation`, and `typescript`.
Finalize the description and topics after reviewing them against implemented Task, Change, validation, and publication behavior.
Do not claim autonomous initiative decomposition or a complete software factory.

## Continuous integration and repository controls

GitHub Actions will run repository-owned `just quality` for pull requests targeting `main`, pushes to `main`, and manual invocation.
Use the repository's locked environment and Just recipes.

Enable the dependency graph and vulnerability alerts without Dependabot update pull requests.
Control security-alert email delivery through maintainer notification settings.
Normal released changes should use pull requests and the But Why Change workflow rather than direct pushes.
Protect version tags matching `v*` from update and deletion.
Define `main` controls that remain workable without requiring approval from a nonexistent second maintainer.

## Artifact verification

Define and run one exact artifact procedure that includes:

- The real prepack path.
- Tarball inspection.
- Isolated global installation.
- Installed CLI behavior.
- Pi skill discovery.
- Implementer-only continuation extension loading.
- Fresh repository initialization.
- A representative supported operation.
- Accurate reporting of any remaining known transitive advisory.

Do not publish from an unverified rebuild that differs from the inspected artifact.

## Publication operations

The first npm publication and GitHub Release are manual external operations.
Define npm authentication and ownership, exact tag creation, GitHub Release creation, and post-publication registry verification before performing them.
External GitHub settings, npm publication, tag creation, and GitHub Release creation are release operations rather than repository implementation Tasks unless they produce a repository Candidate.

## Candidate implementation outcomes

The following remain candidates until their observable outcomes and dependencies are approved:

- Install or repair Pi integration through `by`.
- Use the installed `by` executable throughout published operation.
- Publish the public README and setup path.
- Add MIT and minimal community metadata.
- Run `just quality` in GitHub Actions.
- Identify the stable package and CLI release as `0.1.0`.
- Produce and verify the exact `0.1.0` package artifact.

## Current evidence

Before this planning work, repository-wide `just quality` passed with 101 test files and 898 tests.
A package publication dry run reported a 2.3 MB compressed package and an 11.3 MB unpacked size.
The package included the CLI, public documentation, Pi skill, continuation extension, and source maps.
The npm package name was not published when checked.
The production audit reported two high-severity `brace-expansion` advisories through `@earendil-works/pi-coding-agent`.
The repository had no GitHub Actions workflows or GitHub Releases.

Reverify all current evidence against the release Candidate before relying on it.

## Authorization status

No implementation, external repository configuration, artifact publication, npm publication, tag creation, GitHub Release, or Task Recording is authorized by this plan.
