# Configure the default agent harness during setup

## Status

Not done.

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Make choosing and verifying a default agent harness part of agent-assisted But Why setup.

The setup flow should detect supported installed harnesses, show what it found, and have the user choose the global default when the result is ambiguous.
The chosen harness should be stored once in Global Config and reused across repositories.
Individual Code-Writing Executions and reviewers may select Agent Profiles that override it.

The `by` CLI should remain non-interactive.
Commands should return detected choices and structured guidance so the setup agent or user can make any required choice explicitly.

A configured harness may omit its model when the Sandcastle adapter can let that harness use its own default model.

## Acceptance criteria

- [ ] Agent-assisted setup detects supported installed agent harnesses.
- [ ] Detection reports a definitive empty result when no supported harness is found.
- [ ] Detection reports every supported match when more than one harness is found.
- [ ] Setup chooses the only detected harness automatically.
- [ ] Setup requires an explicit harness choice when detection finds several matches.
- [ ] The selected harness is stored as the global default Agent Profile.
- [ ] Repo config can reuse the global default without naming a harness again.
- [ ] Implementer, Fixer, Specialist, Final, and Acceptance roles can select Agent Profiles that override the global default.
- [ ] Setup verifies that the selected harness can execute successfully.
- [ ] Harness model configuration is optional when the selected Sandcastle adapter supports the harness's own default model.
- [ ] Missing or unusable harness configuration produces a structured typed error with a concrete setup action.
- [ ] Harness detection and verification commands are non-interactive and follow AXI output and exit-code rules.
- [ ] Public setup and config docs explain detection, selection, verification, defaults, and overrides.

## Blocked by

- `docs/issues/039-validate-config-and-reviewer-contracts-with-effect-schema.md`
