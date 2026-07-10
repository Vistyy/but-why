# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `046-publish-by-to-npm-registry.md`
- `047-design-but-why-agent-skill-workflow-content.md`
- `049-configure-default-agent-harness-during-setup.md`

## Remaining dependency graph

```text
049 default agent harness setup
  -> 014 acceptance reviewer
    -> 021 reviewer model eval harness
      -> 015 quality reviewers
        -> 016 publish PR
          -> 040 Effect-scheduled GitHub polling
            -> 017 watch PR
              -> 019 reconcile
                -> 020 daemon
        -> 018 token summaries

046 publish by to npm registry

047 agent skill workflow content
```

## Deferred

- `048-add-planning-phase-intent-reviewer.md` starts after Planning Phase architecture and the Task-readiness workflow are designed.

## Notes

- Issue 049 can start now that config and reviewer Schema contracts exist.
- Acceptance Review uses the shared reviewer runner and context introduced by issue 014.
- Quality Reviewers start after issue 021 establishes and calibrates the reviewer model eval harness.
