# Configure the default agent harness during setup

## Status

Not done.

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Make choosing a Default Agent Profile part of the Agent-Assisted Setup Guide.

The setup agent should identify the harness running the setup and ask whether the user wants to use it or another supported harness.
The setup flow should present the supported choices directly instead of scanning the machine.
The supported runtimes are `pi`, `claude-code`, `codex`, `cursor`, `opencode`, and `copilot`.
Keep this list in one internal runtime adapter registry and test that the public setup guide stays in sync with it.

An Agent Profile is one complete agent configuration containing `agentRuntime` and optional `agentModel` and `thinking` settings.
Global Config should select the default by profile name through `defaultAgentProfile` instead of giving one profile a reserved name.
The setup agent should update Global Config directly, preserve unrelated settings and profiles, and reuse an existing profile when its runtime and model match.
Otherwise it should create a profile named after the runtime.
When that name already belongs to different settings, the setup agent should ask the user for a profile name.

If the setup agent knows its current model, it should suggest that model.
Otherwise it should ask the user for one when the selected adapter requires it.
The config contract should preserve an omitted `agentModel`, while semantic validation should accept omission only when the selected adapter supports the harness's own default model.
The current Sandcastle adapters require a model and should return a typed actionable configuration error when it is omitted.

An agent role may explicitly select an Agent Profile by name.
Explicit selections resolve Repo Config profiles before Global Config profiles.
A role with no explicit selection uses the Default Agent Profile, which always resolves from Global Config even when Repo Config contains a profile with the same name.
Profile selection should use the field name `agentProfile`.
Remove the reviewer `profile` field and inline reviewer runtime, model, and thinking settings so Agent Profiles are the only role-level agent configuration path.
The outer configuration shape for future planning, implementation, and validation roles belongs to the issues that implement those areas.

Validate Agent Profile configuration only when an operation needs to run an agent so unrelated commands remain usable.
Unsupported runtimes, missing profiles, missing required models, and harness launch failures should produce structured typed errors that identify the bad setting and give a concrete setup action.
The setup flow does not need to prove that another selected harness can execute.
A launch failure should be reported when But Why? first attempts to use that harness.

Do not add harness listing, detection, verification, or configuration commands to `by`.

## Acceptance criteria

- [ ] The public Agent-Assisted Setup Guide asks whether to use the current harness or another supported harness without scanning the machine.
- [ ] The supported runtime choices are `pi`, `claude-code`, `codex`, `cursor`, `opencode`, and `copilot`.
- [ ] One internal runtime adapter registry defines the supported choices, and a test keeps the public setup guide in sync with it.
- [ ] Global Config selects a named Agent Profile through `defaultAgentProfile`.
- [ ] Setup updates Global Config directly while preserving unrelated settings and existing Agent Profiles.
- [ ] Setup reuses a matching Agent Profile and handles a conflicting runtime-based profile name by asking the user for another name.
- [ ] An Agent Profile keeps `agentRuntime`, optional `agentModel`, and optional `thinking` together.
- [ ] Setup suggests the current model when known and otherwise asks for a model when the selected adapter requires one.
- [ ] Omitted `agentModel` is valid only when the selected runtime adapter supports the harness's own default model.
- [ ] An explicit `agentProfile` resolves Repo Config first and Global Config second.
- [ ] An omitted `agentProfile` resolves `defaultAgentProfile` from Global Config only.
- [ ] Reviewer configuration uses `agentProfile`; reviewer `profile` and inline runtime, model, and thinking settings are removed.
- [ ] The shared profile-resolution contract can be used by Implementer, Fixer Agent, Specialist Reviewer, Final Reviewer, and Acceptance Reviewer integrations without defining their outer phase config in this issue.
- [ ] Agent Profile validation runs when an operation needs an agent and does not block unrelated commands.
- [ ] Unsupported runtimes, missing profiles, missing required models, and harness launch failures produce structured typed errors with concrete setup actions.
- [ ] Public setup and config docs explain supported harnesses, selection, profile creation, model handling, defaults, overrides, and runtime failure behavior.
- [ ] No new harness listing, detection, verification, or configuration commands are added to `by`.

## Blocked by

- `docs/issues/039-validate-config-and-reviewer-contracts-with-effect-schema.md`
