# Curate explicit reviewer Pi resources

Status: accepted

This ADR records the approved follow-up Task BY-27, not the current BY-13 implementation.
BY-13 retains the strict reviewer boundary that disables discovered extensions, skills, prompt templates, themes, and context files and allows only read, bash, grep, find, and ls.
After BY-13 completes, BY-27 will explicitly load only the package-manager-policy and web-search extensions and the codebase-design skill for Acceptance Reviewers and Specialist Reviewers.
BY-27 will also load normal AGENTS.md and CLAUDE.md context files for the reviewer workspace and add web_search, web_fetch, and web_content_get to the fixed tool allowlist.
Prompt templates, themes, undiscovered extensions and skills, edit, write, and subagent tools will remain unavailable.
This follow-up remains separate from configurable Agent Environment policy.
