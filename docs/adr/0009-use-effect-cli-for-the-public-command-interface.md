---
status: accepted
---

# Use Effect CLI for the public command interface

But Why uses `@effect/cli` as the single owner of command parsing, routing, syntax validation, and generated help.
But Why retains structured TOON and JSON result serialization, but generated help and invalid usage remain opaque library text inside the selected structured envelope.
This removes the maintenance cost and drift of the hand-written command system while preserving the agent-first output boundary.

## Considered Options

- Continue maintaining the hand-written parser, router, help schemas, and syntax errors.
- Use Effect CLI only for token parsing while retaining custom routing and help.
- Let Effect CLI own the complete command tree and adapt its generated output at the serialization boundary.

## Consequences

Command definitions become the authority for dispatch and help.
Global options follow Effect CLI placement before subcommands instead of retaining custom position-independent parsing.
The implementation pins the compatible Effect CLI release instead of forcing an incompatible Effect Platform upgrade across the current Effect SQL stack.
A small generic filter suppresses the confirmed upstream duplicated parent segment in deep root-help entries until the library fixes it.
Normal command results and domain failures retain their existing structured meaning.
