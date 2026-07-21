# Share configuration diagnostic handling

## Specification

- [Configuration reference](../config.md)
- [Validate configuration and reviewer contracts](039-validate-config-and-reviewer-contracts-with-effect-schema.md)
- [Target quality policy](../tooling.md#quality-policy)

## Behaviors owned

- Global Config and Repo Config decode through their own schemas and return their own error types.
- Both contracts derive and format schema diagnostics through one shared behavior.
- Structured CLI diagnostics preserve expected values, received values, paths, and messages.
- Baseline findings D5 and H8 belong to this task.

## What to build

Make Global Config and Repo Config failures produce the same diagnostic fields and formatting rules.

Preserve each configuration schema, source path, error type, and caller-facing behavior.

## Primary verification seam

Configuration contract tests and CLI configuration failures produce stable structured diagnostics for both Global Config and Repo Config.

## Acceptance criteria

- [ ] Valid Global Config and Repo Config values continue to decode through their respective schemas.
- [ ] Invalid values retain distinct error types and source paths.
- [ ] Diagnostic paths, expected values, actual values, and messages remain stable.
- [ ] Baseline findings D5 and H8 are resolved through the public diagnostic behavior.

## Blocked by

- [Task 148](148-establish-audited-quality-baseline.md)
