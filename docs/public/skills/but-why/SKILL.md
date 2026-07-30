---
name: but-why
description: Use when setting up But Why, running its CLI, or implementing and submitting a But Why Change.
---

# But Why

Before setup or workflow guidance, read `docs/public/setup.md` from the installed But Why package or repository.
Before running a But Why command, read [Command guidance](references/command-guidance.md) completely and follow it.

A setup workflow is complete when every mandatory step succeeds, the resolved command prefix succeeds with `--help`, and each required configuration or state artifact contains the documented state.
When the user selects an optional setup step, that step must also succeed.

When a handoff identifies a Change, Task-backed Change, or Managed Worktree, treat the session as Change implementation.
Before inspecting the repository, editing files, or running repository commands, read [Implement a Change](references/implement-change.md) completely and follow it.
