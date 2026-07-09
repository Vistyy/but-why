# Add agent skill for by CLI

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Create the public But Why agent skill artifact and the setup path that tells users and agents how to place it.

This issue is about skill existence, packaging, and installation guidance.
Detailed skill workflow content is deferred to `docs/issues/047-design-but-why-agent-skill-workflow-content.md`.

`docs/public/setup.md` is the Agent-Assisted Setup Guide.
It should include copyable setup instructions that a user can give to an agent or follow manually.
The instructions should install But Why?, run `by init`, consult public setup docs, detect the user's existing skill-location preferences, and ask for confirmation before placing the But Why agent skill.

The packaged skill source is `docs/public/skills/but-why/SKILL.md`.
Installing the skill should be explicit and visible because it can change an agent's workflow.
Skill placement is documentation-guided, not managed by the `by` CLI.

## Acceptance criteria

- [ ] The packaged skill source exists at `docs/public/skills/but-why/SKILL.md`.
- [ ] The skill frontmatter uses `name: but-why`.
- [ ] The skill description is narrow and triggers on running `by` commands or setting up But Why in a repository.
- [ ] The skill body is minimal and points to `docs/public/setup.md` for setup before detailed workflow content exists.
- [ ] The packaged skill source is included in tarballs and future npm releases.
- [ ] `docs/public/setup.md` is the public Agent-Assisted Setup Guide.
- [ ] `docs/public/setup.md` includes copyable instructions that a user can give to an agent.
- [ ] The setup flow tells the user or agent to install But Why? using the current public install guidance.
- [ ] The setup flow tells the user or agent to run `by init` after installation.
- [ ] The setup flow treats skill installation as recommended for agent use, but optional.
- [ ] The setup flow tells the agent to detect existing project and user skill-location conventions before proposing where to place the skill.
- [ ] The setup flow does not present a fixed preferred destination list for skills.
- [ ] The setup flow includes an option to skip skill installation.
- [ ] The setup flow asks for explicit confirmation before copying the skill.
- [ ] The setup flow preserves the folder shape `<chosen-skill-root>/but-why/SKILL.md`.
- [ ] The setup flow asks the user to choose project or user scope after showing detected conventions.
- [ ] The setup flow shows a diff or summary and asks for confirmation before overwriting an existing `but-why` skill.
- [ ] README contains this minimal copyable prompt and does not duplicate setup steps:

  ```text
  Install But Why for this repository.
  Follow docs/public/setup.md in this repository.
  Before installing the agent skill, detect my existing skill conventions and ask where to place it.
  ```
- [ ] `by init` output points to `docs/public/setup.md` and may mention the packaged skill path.
- [ ] `by init` does not install or copy the skill.
- [ ] Issue 041 does not add a `by` command for skill installation.
- [ ] Detailed CLI workflow guidance for the skill is deferred to `docs/issues/047-design-but-why-agent-skill-workflow-content.md`.

## Blocked by

- 013-inspect-runs-and-latest-task-findings.md
- 043-guide-init-validation-configuration.md
- 044-package-by-as-installable-cli.md
