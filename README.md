# But Why?

But Why? is a local-first validation system for agent-assisted code changes.

The CLI is `by`.

It asks the question that normal CI does not ask:

> But why does this implementation actually satisfy the approved intent?

## Core idea

But Why? validates completed work against approved context before it becomes merge-ready.

It is not a planner.

It is not a generic workflow engine.

It is a thin decision layer around existing tools.

## Shape

```text
approved intent + code change
  -> isolated execution workspace
  -> checks
  -> reviewer agents
  -> findings
  -> fix / ask user / reject / pass
  -> PR and CI babysitting
```

## CLI sketch

```bash
by run --intent <artifact-or-source>
by status
by findings
by respond <decision-id> --choice <choice>
by resume <run-id>
by pr watch <pr>
```

## Design stance

But Why? should delegate execution plumbing as much as possible.

It should keep authority over validation semantics.

External tools run work.

But Why? decides what the result means.
