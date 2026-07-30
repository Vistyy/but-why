# Agent Profiles and Host Execution

Status: Approved specification

## Problem Statement

But Why currently limits Agent Profiles to runtime, model, and thinking settings.
Reviewer Pi resources are hard-coded, while Interactive Sessions cannot select Repo Agent Profiles or configure the extensions that Pi loads.
This prevents users and repositories from defining the agent behavior they need through one clear configuration model.
The existing configuration also accepts placeholder runtimes that current workflows cannot execute.

Change Implement currently depends on Pi discovering and invoking the But Why skill instead of receiving the required implementation instructions directly.
That makes the workflow sensitive to skill discovery and profile configuration.

But Why also exposes Docker and Podman validation modes that are not maintained as trustworthy isolation boundaries.
Supporting configurable agent resources through those incomplete paths would add compatibility work without providing a supported v1 capability.

## Solution

But Why will expand Agent Profiles into named reusable runtime configurations.
V1 will support only Pi Agent Profiles.
Each Pi profile may configure model, thinking, extensions, skills, tools, and context-file discovery through a Pi-owned runtime configuration.
Runtime resource settings that are omitted will preserve normal Pi behavior, while configured resource lists will be exact allowlists.

Agent Profiles and profile selections may be defined at Repo and Global scope.
Every selection will explicitly identify the profile name and scope.
Agent roles will resolve a Repo selection first, a Global selection second, and the Global Default Agent Profile last.

Setup will create separate editable Global profiles for reviewers and the Implementer.
The reviewer default will preserve the current curated BY-27 resources.
The Implementer profile will use the approved extension allowlist while leaving skills, tools, and context-file discovery at normal Pi behavior.

Change Implement will place the shipped But Why skill body and Implement a Change reference directly into Pi system instructions.
The initial Pi prompt will contain only the Change identity, Managed Worktree, and optional handoff.
The workflow will not depend on Pi skill discovery or slash-command invocation.

V1 validation and agent execution will run on the host only.
Docker and Podman configuration and integration will be removed.
Sandcastle will remain as the internal host workspace and process adapter for v1.

## User Stories

1. As a user, I want an Agent Profile to describe the behavior-affecting settings for its runtime, so that agent launches are configured in one place.
2. As a repository owner, I want Repo Agent Profiles and selections, so that repository-specific agent resources do not pollute Global Config.
3. As a user, I want Global Agent Profiles and fallbacks, so that I can reuse my preferred agent configuration across repositories.
4. As a user, I want profile references to identify their scope, so that duplicate Repo and Global profile names are unambiguous.
5. As an operator, I want commands and validation records to report the selected profile and scope, so that I can see which configuration was used.
6. As an Implementer, I want Change Implement to receive the required But Why instructions directly, so that implementation does not depend on skill discovery.
7. As an Implementer, I want only the approved extensions loaded while normal Pi skills, tools, and repository context remain available, so that the session is capable without loading unrelated extensions.
8. As a reviewer operator, I want the current curated reviewer behavior represented by an editable Agent Profile, so that the default remains useful without hard-coded runtime flags.
9. As a user, I want unsupported runtime configuration rejected clearly, so that accepted configuration always corresponds to executable behavior.
10. As a repository owner, I want v1 to expose only supported host execution, so that container settings do not imply an isolation guarantee that But Why does not provide.

## Implementation Decisions

### Agent Profile contract

An Agent Profile is a named reusable configuration of one agent runtime.
The v1 profile contract accepts only `agentRuntime: "pi"`.
The profile stores Pi-owned settings under `runtimeConfig` rather than adding Pi-shaped fields to the generic profile level.

The Pi runtime configuration supports:

- `model`.
- `thinking`.
- `extensions`.
- `skills`.
- `tools`.
- `contextFileDiscovery`.

Model and thinking retain their role-specific requirements.
Reviewers require an explicit model.
Interactive Sessions may preserve Pi's normal model behavior when the model is omitted.

Omitted extensions, skills, tools, or context-file discovery preserve normal Pi behavior.
A configured extensions, skills, or tools array is an exact allowlist, including an empty array meaning none.
Configured resource arrays disable ambient discovery for that resource type before loading their entries.
But Why does not classify tools as safe or unsafe and does not apply role-specific tool ceilings.
Reviewer immutability remains protected by Validation Workspace behavior, Candidate integrity checks, output contracts, and Validation Tooling Failures.

Themes and prompt templates are not Agent Profile settings because they do not implicitly alter background-agent reasoning or capabilities.
Background execution may disable their discovery as fixed runtime hygiene without treating them as configurable profile resources.

The old flat `agentModel` and `thinking` profile shape is removed.
The existing placeholder non-Pi profile variants are removed until a runtime has an executable adapter and validated configuration contract.
Old configuration is rejected with diagnostics that identify the new Pi `runtimeConfig` shape.
No compatibility parser or automatic migration is provided because the product is unreleased.
Repository configuration, setup guidance, examples, tests, and local configuration used by this repository must move to the new shape.

### Profile scope and selection

Agent Profiles may be declared in Repo Config or Global Config.
A profile reference contains an explicit `scope` of `repo` or `global` and the profile `name`.
Duplicate names across scopes are valid because the reference is unambiguous.

Every agent role uses this selection order:

1. An explicit Repo Config selection.
2. An explicit Global Config selection.
3. The Global Default Agent Profile.

An explicit selection resolves only the named profile in its declared scope.
The Default Agent Profile remains Global-owned.
Repo Config gains an Interactive Session profile selection, while the existing Global selection remains its fallback.
Reviewer selectors use the same scoped reference contract.

Change Implement structured output reports the resolved profile name and scope.
Validation policy records and inspection output report each resolved reviewer profile name and scope.
Configuration failures report the unresolved or invalid scoped reference.
A duplicate name alone does not produce a warning.

### Resource sources

A relative path in a Repo Agent Profile resolves from the repository root and must remain within the repository.
A relative path in a Global Agent Profile resolves from the Global Config directory.
Global profiles may also use supported absolute paths and Pi extension package sources.

Interactive Session Repo resources resolve from the Managed Worktree.
Change Submit loads Repo Config once from the Change's Managed Worktree and uses it for Repository Preparation, Checks, Validation Workspace files, reviewer configuration, Repo Agent Profiles, and the Agent Environment.
The caller checkout supplies Local Repository identity and shared state but does not supply Validation Policy settings.
Global Config continues to supply Global Agent Profiles and reviewer defaults.
The resolved Validation Policy includes the Agent Environment before validation starts and is reused for validation evidence and eligible publication.
A Candidate can therefore modify its own reviewer configuration and other Repo-owned validation settings.
This is an accepted trust limitation, and But Why will not add Change Base profile resolution or delayed activation.

### Default Global profiles

Setup creates a Global reviewer profile and makes it the Global Default Agent Profile.
That profile expresses the current BY-27 reviewer behavior as configuration:

- The `package-manager-policy` extension.
- The `web-search` extension.
- The `codebase-design` skill.
- The exact reviewer tool list of `read`, `bash`, `grep`, `find`, `ls`, `web_search`, `web_fetch`, and `web_content_get`.
- Normal context-file discovery.

Setup also creates a separate Global Implementer profile and selects it for the Interactive Session.
The Implementer profile configures this exact extension allowlist:

- `inline-skills`.
- `openai-remote-compaction`.
- `package-manager-policy`.
- `web-search`.
- `herdr-agent-state.ts`.
- `openai-fast.ts`.
- `output-style.ts`.
- `statusline.ts`.
- `fuzzy-files/`.
- `codex-usage.ts`.
- `codex-resets.ts`.
- `npm:@ogulcancelik/pi-auto-permissions@0.1.2`.

All other extensions are disabled for that profile.
Skills, tools, and context-file discovery are omitted from the Implementer profile and therefore use normal Pi behavior.
The absence of subagent, Lavish, and session-recall extensions means those capabilities are not loaded through the Implementer extension set.
Users may edit or replace either generated profile.

### Implementer instruction delivery

Change Implement constructs Pi system instructions from the body of the shipped But Why skill and the shipped Implement a Change reference.
Change Implement constructs the initial Pi prompt from the Change identity, Managed Worktree handoff, and optional user handoff content.
The shipped files are the canonical instruction source for both manual skill use and Change Implement.
Change Implement reads and expands their content directly instead of asking Pi to discover the skill or sending `/skill:but-why`.
The Agent Profile skill configuration therefore does not need to include the But Why skill.

### Pi execution ownership

Pi command construction and resource handling remain in a Pi-owned implementation boundary.
The implementation retains `agentRuntime` as the discriminator but does not introduce a generalized runtime-materialization framework.
A shared adapter abstraction will be considered only when a second runtime is implemented.

### Host-only execution

V1 supports host execution only.
The Repo Config `validation.sandbox` setting and its `none`, `docker`, and `podman` values are removed rather than deprecated.
Docker and Podman provider selection, resource mounts, compatibility logic, tests, and current documentation are removed.
Configuration containing the removed sandbox setting is rejected as an unknown property.

Sandcastle remains behind the existing But Why domain seams for disposable Validation Workspaces and host process execution.
Its host path remains an implementation adapter and is not exposed as a configurable sandbox mode.

## Testing Decisions

The required external behavior is that valid scoped Pi profiles control Interactive Session and reviewer launches, invalid profiles fail before launch, Implementer instructions arrive as system instructions, and validation offers no Docker or Podman configuration path.

The primary acceptance seam is the in-process public CLI boundary for `by change implement` and `by change submit`.
Acceptance tests will exercise config loading, scoped profile resolution, structured output, Interactive Session launch, reviewer execution, and failure behavior while replacing only external host and agent adapters.
Change Submit recovery tests will verify that only the four authorized recovery errors contain structured Submit Recovery Guidance, while blocked, uncertain, and operator-owned failures do not authorize Implementer recovery.
A Change Submit acceptance case will invoke the command from a checkout whose Repo Config differs from the Managed Worktree and prove that the complete Repo-owned Validation Policy comes from the Managed Worktree.

Supporting config-contract tests will cover the Pi `runtimeConfig` shape, explicit scoped references, Repo-over-Global role selection, exact allowlist semantics, old-profile rejection, non-Pi rejection, and rejection of the removed sandbox setting.

Supporting Pi command tests will cover exact extension and resource flags for reviewers and the Implementer.
The Interactive Session host seam will verify that system instructions contain the shipped skill body and implementation reference, and that the initial prompt contains the Change handoff and optional user handoff in the required order.

Supporting Validation Workspace lifecycle tests will prove that host workspace creation, execution, integrity verification, and cleanup remain functional after Docker and Podman removal.
Container-provider and mount tests will be deleted because they protect retired behavior rather than a supported prohibition.

Tests will follow the repository's existing in-process CLI, config contract, reviewer runtime, Interactive Session host, and Validation Workspace lifecycle precedents.
Implementation will proceed as vertical red-green tracer bullets through these seams.

## Out of Scope

- Executing Codex, Claude Code, Cursor, OpenCode, Copilot, or another non-Pi runtime.
- A generalized multi-runtime adapter or resource-materialization framework.
- Docker, Podman, or other container execution in v1.
- Treating containers as a security boundary.
- Replacing Sandcastle in v1.
- Automatic migration or compatibility support for the old Agent Profile schema.
- Preventing a Candidate from changing its own reviewer configuration.
- Inferring tool safety or suitability from tool names.
- Configuring themes or prompt templates through Agent Profiles.

## Further Notes

Containerization and replacement of Sandcastle remain post-v1 design questions.
The container open question should state that v1 has no configurable container path rather than describing the removed implementation as partial support.

The current configuration and architecture documentation still describe fixed reviewer resources, Global-only Interactive Session selection, placeholder runtimes, and Docker or Podman modes.
Implementation must update every affected current source so this specification and shipped behavior agree.

No new ADR is required for this specification.
The changes affect unreleased configuration and execution behavior and remain inexpensive to reverse, while ADR 0001 already owns the decision to keep Sandcastle behind But Why domain seams.
