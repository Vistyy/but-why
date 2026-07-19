---
name: handoff-to-worktree
description: "[M] Start a Change and hand this work to a fresh Pi session in its Managed Worktree."
argument-hint: "What should the fresh session implement?"
disable-model-invocation: true
---

Create a compact handoff document for a fresh Pi session.
Save it in the operating system temporary directory, never in the current workspace.
Include the next implementation goal, relevant decisions, references to existing artifacts, and suggested skills.
Do not copy artifacts that can be referenced by path or URL.
Do not include sensitive information.

Use a temporary file with cleanup guaranteed after Change Implement returns:

```sh
handoff_file="$(mktemp "${TMPDIR:-/tmp}/but-why-handoff.XXXXXX.md")"
trap 'rm -f "$handoff_file"' EXIT
```

Write the compact handoff to `$handoff_file`.
Then run `by change start --output json`.
If it fails, report the structured failure in this session and stop.
Read `change.id` from its JSON result.
Run `by change implement <change-id> --handoff-file "$handoff_file" --output json`.
If it fails, report the structured failure in this session and stop.
After Change Implement returns, remove `$handoff_file`.

Do not copy, fork, switch, or retarget the current Pi session.
The fresh Herdr-hosted Pi session owns the implementation work in the Managed Worktree.
