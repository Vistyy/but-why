# Add repo documentation and local-state checks

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Add small repo-specific checks for rules that do not fit TypeScript, Biome, Fallow, or ast-grep.

These checks should focus on documentation and local runtime safety.

They should be small, boring, and easy for agents to understand when they fail.

The first rules should block em dashes and verify that local state and runtime paths remain ignored.

Sentence-per-line Markdown checks may be added only if they can be implemented without noisy false positives.

## Acceptance criteria

- [ ] A repo-specific check command exists for documentation and local-state rules.
- [ ] The check fails when tracked text contains an em dash.
- [ ] The check verifies local SQLite state paths remain ignored.
- [ ] The check verifies Sandcastle runtime paths remain ignored.
- [ ] The check prints actionable diagnostics with file paths.
- [ ] The check is wired into the quality command.
- [ ] Sentence-per-line Markdown checking is either implemented with low noise or explicitly deferred.
- [ ] Quality passes with the new checks enabled.

## Blocked by

None - can start immediately.
