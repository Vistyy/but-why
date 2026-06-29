# Prove Sandcastle can support v1 execution

## Parent

`docs/prd.md`

## What to build

Run a focused spike that proves whether Sandcastle can be the v1 execution engine for But Why?.

The spike should prove validation worktrees from temp refs, command checks, Pi reviewer agents, structured output validation and retry, logs, token usage, and cleanup.

This is a go/no-go spike, not product implementation.

## Acceptance criteria

- [ ] A temp validation ref can be created from a submitted commit and used by Sandcastle for an isolated validation worktree.
- [ ] A configured command can run in the validation worktree and expose exit code, stdout, stderr, and logs.
- [ ] A Pi reviewer agent can run in the validation worktree through Sandcastle.
- [ ] Structured reviewer JSON can be validated.
- [ ] Invalid structured output can be corrected in the same agent thread, or a blocker is documented.
- [ ] Token usage can be read or missing fields are documented by runtime.
- [ ] Validation worktree and temp ref cleanup is proven.
- [ ] A spike report records verdict, Sandcastle version or commit, commands run, prototype path, what worked, what failed, and recommended next action.

## Blocked by

None - can start immediately.
