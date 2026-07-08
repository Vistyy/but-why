# Make Finding severity optional by producer contract

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Make Finding severity optional at the domain level and required only by producer contracts that can make a meaningful impact judgment.

In v1, all Findings are blocking.
Blocking is the workflow effect of a Finding.
Severity is an impact judgment, not the reason a Finding blocks validation.

Command-produced Findings, such as failed checks and prepare failures, must not invent hard-coded severity.
Reviewer-produced Findings must continue to include severity because reviewer roles are expected to judge impact against Task Context and code quality.

## Acceptance criteria

- [x] Finding records support missing severity as an optional property, not as domain-level `null`.
- [x] Finding storage supports missing severity as `NULL` while preserving allowed values when severity is present.
- [x] Structured CLI output does not include a `severity` field when a Finding has no severity.
- [x] Human-readable CLI output shows no severity line when a Finding has no severity.
- [x] Failed check Findings do not include a `severity` field.
- [x] Timed-out check Findings do not include a `severity` field.
- [x] Check config does not support a severity field in v1.
- [x] Prepare config does not support a severity field in v1.
- [x] Reviewer output contracts still require `severity`.
- [x] Reviewer-produced Findings still reject missing or invalid severity.
- [x] Reviewer severity enforcement happens at the reviewer output contract boundary, not in generic Finding storage.
- [x] Docs explain that all v1 Findings are blocking, regardless of severity.
- [x] Docs explain that severity is optional on a Finding and required by reviewer producer contracts.
- [x] `docs/issues/012-run-check-commands-and-create-check-findings.md` no longer requires hard-coded check severity.
- [x] Tests cover command-produced Findings without severity.
- [x] Tests cover reviewer output rejection when severity is missing.

## Blocked by

- None.
