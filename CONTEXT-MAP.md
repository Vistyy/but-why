# But Why Context Map

## Contexts

- [Task Intent](./docs/context/task-intent/CONTEXT.md) - owns requested intent, Task Submission, dependencies, and user-facing Task progress.
- [Change Delivery](./docs/context/change-delivery/CONTEXT.md) - owns code lineage, implementation, Candidate selection, validation, publication, reconciliation, and Change completion.
- [Repository Runtime](./docs/context/repository-runtime/CONTEXT.md) - owns repository identity, shared operational state, configuration, executable selection, preparation, and agent runtime configuration.

## Relationships

- **Task Intent -> Change Delivery**: Change Start can link one approved Task, capture its Acceptance Context, and create a Change linked to a Task.
- **Change Delivery -> Task Intent**: Change state advances the linked Task lifecycle, and an approved Implementation Blocker Resolution becomes part of the current derived Acceptance Context.
- **Repository Runtime -> Task Intent**: Shared Repository State persists Tasks.
- **Repository Runtime -> Change Delivery**: Shared Repository State persists Changes and validation evidence, while resolved configuration supplies preparation, validation, reviewer, and Interactive Session behavior.
