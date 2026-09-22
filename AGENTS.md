# Contributor guidance

`README.md` owns But Why's supported CLI, rules, reviewer authority, and result behavior. Keep the runner limited to these current responsibilities; do not restore the old Task, Change, validation-gate, or publication system.

`VERIFICATION.md` explains which supported boundaries require real Git or a real Pi session. Use disposable repositories for review-run tests; never use a live repository or a globally installed `by` executable as a test fixture. Preserve dirty or uncertain worktrees instead of force-removing them.

Use the pinned `@syzom/typescript-quality` configuration and compatible Effect version rather than copying shared rules into this repository. Run the focused checks relevant to the change; use the complete checks before handback. Change source and regenerate output rather than editing `dist/`.
