# Prove Sandcastle can support v1 execution

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Run a focused spike that proves whether Sandcastle can be the v1 execution engine for But Why?.

The spike should prove validation worktrees from temp refs, command checks, Pi reviewer agents, structured output validation and retry, logs, token usage, and cleanup.

This is a go/no-go spike, not product implementation.

## Acceptance criteria

- [x] A temp validation ref can be created from a submitted commit and used by Sandcastle for an isolated validation worktree.
- [x] A configured command can run in the validation worktree and expose exit code, stdout, stderr, and logs.
- [x] A Pi reviewer agent can run in the validation worktree through Sandcastle.
- [x] Structured reviewer JSON can be validated.
- [x] Invalid structured output can be corrected in the same agent thread, or a blocker is documented.
- [x] Token usage can be read or missing fields are documented by runtime.
- [x] Validation worktree and temp ref cleanup is proven.
- [x] A spike report records verdict, Sandcastle version or commit, commands run, prototype path, what worked, what failed, and recommended next action.

## Blocked by

None - can start immediately.
