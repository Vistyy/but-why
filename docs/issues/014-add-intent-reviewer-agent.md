# Add intent reviewer agent

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Run the configured intent reviewer through Sandcastle after checks pass.

The intent reviewer should judge whether the submitted branch satisfies the Task Context before other reviewer roles run.

## Acceptance criteria

- [ ] Intent review runs only after checks pass.
- [ ] Intent reviewer input includes Task title, description, comments, repo context, and diff.
- [ ] Reviewer output is JSON validated with Effect Schema.
- [ ] Sandcastle structured output retry is used instead of a custom retry loop.
- [ ] Valid reviewer Findings are stored on the Run.
- [ ] Any intent Finding moves the Task to `needs_input`.
- [ ] Empty findings allow validation to continue.
- [ ] Token usage is stored for the intent reviewer producer and model.
- [ ] Missing reviewer profile fails during preflight with a structured error.

## Blocked by

- `docs/issues/028-snapshot-task-context-for-validation-runs.md`
