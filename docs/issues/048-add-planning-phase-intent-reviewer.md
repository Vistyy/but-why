# Add planning-phase intent reviewer

## Status

Not done.

## Parent

Planning Phase architecture and the Task-readiness workflow are not yet defined.

## What to build

Add an Intent Reviewer to the future planning phase.

The Intent Reviewer should inspect Task Context before implementation and judge whether the intended result is clear, complete, internally consistent, and ready for an Implementer.

Questions or missing decisions should keep the Task in human-supervised refinement.
The Intent Reviewer should not inspect a code submission or decide whether implementation work satisfies Task Context.

## Acceptance criteria

- [ ] Intent Review runs before a Task becomes eligible for autonomous implementation.
- [ ] Intent Review judges Task Context without requiring a code submission.
- [ ] Intent Review identifies unclear requirements, contradictions, and missing human decisions.
- [ ] Intent Review keeps unresolved Tasks in human-supervised refinement.
- [ ] A clean Intent Review allows the normal approval handoff to `todo`.
- [ ] Intent Reviewer output and tooling failures remain separate typed results.
- [ ] The reviewer can inspect repository documentation and agent skills for project and domain context.
- [ ] But Why? provides a default Intent Reviewer prompt that users can replace.

## Blocked by

- Planning-phase architecture and Task-readiness workflow design.
