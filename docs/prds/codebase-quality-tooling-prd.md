# Codebase Quality Tooling PRD

## Problem Statement

But Why is entering work where architecture mistakes can become expensive.

The current quality gate catches formatting, common lint problems, type errors, and test failures.

It does not strongly guard module boundaries, Task authority assumptions, Run storage seams, direct SQL access, CLI output boundaries, raw Task ID assumptions, or documentation hygiene.

This creates room for agents and humans to make small local changes that quietly weaken the architecture.

The user wants stricter automated guardrails so future contributors do not need to remember every architectural rule manually.

## Solution

Add a stricter local quality gate that combines existing tools with architecture and pattern checks.

Biome remains responsible for formatting and ordinary linting.

TypeScript remains responsible for strict type checking.

Vitest remains responsible for behavior tests.

Fallow is added for module boundaries, cycles, dead code, duplication, complexity, and architecture drift.

ast-grep is added for exact forbidden code patterns that are easier to express structurally than through import graph rules.

Small custom checks are used only for repo-specific text and documentation rules that do not fit the other tools.

The quality gate should be easy for agents to run, should fail with actionable messages, and should become stricter as stable seams land.

## User Stories

1. As a maintainer, I want one quality command to run all required checks, so that agents and humans have one obvious pre-submit gate.

2. As a maintainer, I want formatting drift to fail the quality gate, so that formatting does not become a review concern.

3. As a maintainer, I want ordinary lint failures to fail the quality gate, so that common code mistakes are caught before review.

4. As a maintainer, I want strict TypeScript errors to fail the quality gate, so that type-safety regressions are blocked.

5. As a maintainer, I want test failures to fail the quality gate, so that behavior regressions are blocked.

6. As a maintainer, I want architecture boundary violations to fail the quality gate, so that module seams stay intentional.

7. As a maintainer, I want circular dependencies to fail the quality gate, so that modules remain understandable and removable.

8. As a maintainer, I want dead code to be reported, so that unused implementation paths do not accumulate.

9. As a maintainer, I want duplicate code and complexity hotspots to be reported, so that maintainability risks are visible early.

10. As a maintainer, I want domain code blocked from importing CLI serializers, so that domain modules stay independent of stdout formats.

11. As a maintainer, I want command code blocked from importing SQLite implementation details, so that storage seams stay deep.

12. As a maintainer, I want direct SQLite access limited to storage implementation code, so that SQL does not leak across the codebase.

13. As a maintainer, I want direct stdout writes limited to the CLI edge, so that structured output remains controlled.

14. As a maintainer, I want console logging blocked in production source, so that diagnostics use the intended CLI channels.

15. As a maintainer, I want inline Task state unions blocked after the lifecycle seam exists, so that Task Lifecycle vocabulary stays centralized.

16. As a maintainer, I want raw Task ID parsing blocked outside the Task ID seam, so that future local and remote Task IDs remain possible.

17. As a maintainer, I want branch and worktree names built through safe slug helpers, so that raw Task IDs do not leak into filesystem or Git names.

18. As a maintainer, I want TaskStore and RunStore boundaries guarded after they exist, so that Task authority and local Run history do not collapse back into one broad store.

19. As a maintainer, I want ValidationRuns to be the seam for starting validation, so that submit code does not manually coordinate Task state and Run records.

20. As a maintainer, I want generated and local state paths protected by checks, so that local databases and runtime files are not accidentally committed.

21. As a maintainer, I want documentation style rules checked automatically where practical, so that planning docs stay readable for agents.

22. As a maintainer, I want em dashes blocked automatically, so that repository writing follows the agent instructions.

23. As an implementing agent, I want quality failures to include clear file and rule information, so that I can repair the issue without guessing.

24. As an implementing agent, I want architecture rules to be encoded in tools, so that I do not need to infer hidden conventions from prior code.

25. As a reviewer, I want quality output to separate formatting, lint, type, test, boundary, pattern, and docs failures, so that review triage is fast.

26. As a reviewer, I want new rules introduced in warning or report mode when they may produce noisy findings, so that the team can tune them before making them blocking.

27. As a maintainer, I want stable rules promoted to blocking checks, so that known architectural decisions stay enforced.

28. As a maintainer, I want tool configuration to be explicit rather than relying only on defaults, so that future upgrades do not silently weaken important checks.

29. As a maintainer, I want the stricter gate to remain fast enough for normal local use, so that agents run it routinely.

30. As a maintainer, I want the same quality gate to be usable in CI later, so that local and remote validation agree.

## Implementation Decisions

- The quality gate remains the highest test and validation seam for codebase health.

- Existing formatting, linting, typechecking, and behavior tests stay in the quality gate.

- Biome remains the formatter and ordinary linter.

- Biome rules should be made explicit for standards the project cares about, even if some are already recommended by default.

- Biome should block console usage, explicit `any`, non-null assertions, import cycles where supported, and barrel files where supported.

- TypeScript stays in strict mode.

- TypeScript should add stricter options for unreachable code, unused labels, and index-signature property access if they are compatible with the existing codebase.

- Fallow is the preferred tool for module boundary checks and import graph health.

- Fallow should be used for architecture boundaries, circular dependencies, dead code, unused exports, duplication, and complexity reporting.

- Fallow boundary rules should start with stable existing seams and become stricter after TaskStore, RunStore, and ValidationRuns are introduced.

- ast-grep is the preferred tool for exact structural code-pattern bans.

- ast-grep should not be used as the main module boundary tool when an import graph tool can express the rule more directly.

- ast-grep rules should block direct SQLite construction outside storage implementation code.

- ast-grep rules should block raw SQL calls outside storage implementation code where the pattern is reliable.

- ast-grep rules should block direct stdout writes outside the CLI edge.

- ast-grep rules should block inline Task state unions after the Task lifecycle seam exists.

- ast-grep rules should block raw Task ID regex parsing outside the Task ID seam.

- ast-grep rules should block direct branch or worktree path construction from raw Task IDs once safe slug helpers exist.

- ast-grep rules should block direct process-global access outside the CLI edge.

- ast-grep rules should block direct Effect runtime execution outside the CLI edge while allowing normal Effect construction and composition.

- ast-grep rules should block output serialization outside output and stdout-boundary seams.

- ast-grep rules should block direct Sandcastle sandbox factory calls outside the validation workspace seam.

- ast-grep rules should block direct child-process execution outside command adapter seams.

- ast-grep rules should block branded Task identity casts outside the Task ID seam.

- ast-grep rules should block filesystem mutation, destructive filesystem APIs, and raw file reads outside their named seams where the pattern is reliable.

- ast-grep rules should block fs import shapes that bypass named API rules.

- ast-grep rules should block ad hoc JSON parsing and stringification outside repo config, external-tool parser, and output seams.

- ast-grep rules should block direct wall-clock reads outside the CLI edge while allowing timestamp parsing or conversion.

- Small custom checks are acceptable for repository-specific text rules that do not fit Biome, Fallow, TypeScript, Vitest, or ast-grep.

- Custom checks should stay small and boring.

- Custom checks should not become a second linter for TypeScript code.

- Documentation checks should include the no-em-dash rule.

- Documentation checks may include sentence-per-line validation for long Markdown files if the rule can be implemented without excessive noise.

- Local state and runtime paths should remain ignored and should be guarded by a check.

- The stricter gate should be added incrementally.

- Rules that are already true should become blocking immediately.

- Rules that require issue 023 or the store split should be added with those issues, not before the seam exists.

- Rules with uncertain noise should start as report-only or be kept out of the blocking gate until tuned.

- The quality gate should print actionable diagnostics and return a non-zero exit code on blocking failures.

## Testing Decisions

- The main test seam is the full quality gate observed through the command an agent will run.

- Tool configuration should be tested by running the real tools, not by unit-testing config files.

- Pattern rules should have small positive and negative fixtures when the tool supports rule tests.

- Boundary rules should be verified with small intentional violation fixtures if the tool supports them, or by targeted smoke checks.

- Existing behavior tests remain responsible for product behavior.

- Architecture tools should not replace behavior tests.

- TypeScript and Biome should stay responsible for broad language-level correctness.

- Fallow should stay responsible for import graph and codebase health rules.

- ast-grep should stay responsible for exact syntax-pattern bans.

- Custom checks should have direct tests when their logic is not trivial.

- Quality gate tests should avoid asserting every line of third-party tool output.

- Quality gate tests should assert success, failure, and actionable rule identification where practical.

## Out of Scope

- Replacing Biome with Fallow.

- Replacing TypeScript strictness with lint rules.

- Replacing behavior tests with static analysis.

- Adding coverage thresholds in this slice.

- Building a custom full TypeScript linter.

- Blocking all raw SQL in tests.

- Enforcing future TaskStore, RunStore, and ValidationRuns boundaries before those seams exist.

- Adding CI unless explicitly pulled into the implementation slice.

- Adding remote Task Surface support.

- Changing product behavior.

## Further Notes

The current quality baseline is already useful, but it mostly protects local code correctness.

The next risk is architecture drift.

The most valuable improvement is to make architectural decisions executable through tools.

The first implementation should prefer simple, high-signal rules over broad noisy rules.

The tooling should help agents succeed by making the right path obvious and the wrong path fail early.
