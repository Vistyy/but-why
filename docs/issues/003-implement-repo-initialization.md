# Implement repo initialization

## Parent

`docs/prd.md`

## What to build

Implement repo-local initialization for But Why?.

Initialization should create the local state and config structure needed by later task and validation commands.

The initial repo shape is the stable minimum:

```text
.but-why/
  config.json
  state.sqlite
  reviewers/
.gitignore
```

`.but-why/config.json` is tracked and initially contains only the selected task prefix:

```json
{
  "taskPrefix": "BY"
}
```

`.but-why/reviewers/` is created as the reviewer-instruction location, but init does not create default reviewer files.
Default reviewer roles are intentionally left to a later decision.

Init adds only mutable local SQLite state to `.gitignore`:

```gitignore
.but-why/state.sqlite
.but-why/state.sqlite-*
```

`.but-why/config.json` and `.but-why/reviewers/` are repo policy and should remain trackable.

Init is repair-idempotent:

- If all initialized artifacts already match, init succeeds without changes.
- If `.but-why/config.json` exists with the requested `taskPrefix`, init recreates missing generated artifacts such as SQLite state, reviewer directory, or `.gitignore` entries.
- If `.but-why/config.json` exists with a different `taskPrefix`, init fails.
- If `.but-why/config.json` is malformed, init fails.
- Issue 003 does not add `--force`.

Init requires the current directory to be inside a Git work tree.
If no Git work tree is found, init fails with a structured actionable error.
When run from a subdirectory, init initializes the Git work tree root, not the shell's current directory.

Issue 003 creates `.but-why/state.sqlite` with migration metadata only.
It does not create task, run, finding, or reviewer tables.
Those tables belong to later feature issues.

If `--task-prefix` is missing in a non-TTY context, init fails with a structured missing-flag error.
If `--task-prefix` is missing in a TTY context, init may prompt a human for the prefix.

A successful first init writes this TOON-style shape to stdout:

```toon
init:
  status: initialized
  root: /repo/path
  taskPrefix: BY
created[3]:
  .but-why/config.json
  .but-why/state.sqlite
  .but-why/reviewers/
updated[1]:
  .gitignore
```

A no-op rerun writes this TOON-style shape to stdout:

```toon
init:
  status: unchanged
  root: /repo/path
  taskPrefix: BY
```

A repair rerun writes `status: repaired` and lists only the paths changed during that invocation:

```toon
init:
  status: repaired
  root: /repo/path
  taskPrefix: BY
created[1]:
  .but-why/state.sqlite
updated[1]:
  .gitignore
```

Task prefixes must match `^[A-Z][A-Z0-9]{1,9}$`.
The prefix is the part before the task ID hyphen, as in `BY-1`.

If an existing config has a different task prefix, init fails with this TOON-style shape:

```toon
error:
  code: task_prefix_conflict
  message: Repository is already initialized with task prefix OLD.
  path: .but-why/config.json
  existingTaskPrefix: OLD
  requestedTaskPrefix: BY
help[1]:
  Keep using OLD, or manually migrate .but-why/config.json before running init again.
```

If init is run outside a Git work tree, it fails with this TOON-style shape:

```toon
error:
  code: not_git_work_tree
  message: by init must be run inside a Git work tree.
help[1]:
  Run git init first, or cd into an existing Git repository.
```

If `--task-prefix` is missing in a non-TTY context, init fails with this TOON-style shape:

```toon
error:
  code: missing_task_prefix
  message: --task-prefix is required in non-interactive init.
help[1]:
  Run by init --task-prefix BY.
```

If the task prefix is invalid, init fails with this TOON-style shape:

```toon
error:
  code: invalid_task_prefix
  message: Task prefix must match ^[A-Z][A-Z0-9]{1,9}$.
  taskPrefix: by
help[1]:
  Use 2 to 10 uppercase letters or digits, starting with a letter, such as BY.
```

If `.but-why/config.json` exists but is invalid JSON or has the wrong schema, init fails with this TOON-style shape:

```toon
error:
  code: invalid_repo_config
  message: .but-why/config.json is not valid But Why? repo config.
  path: .but-why/config.json
help[1]:
  Fix the JSON or move the file aside before running init again.
```

If `.gitignore` does not exist, init creates it.
Init manages this idempotent labeled block and must not duplicate it:

```gitignore
# But Why?
.but-why/state.sqlite
.but-why/state.sqlite-*
```

The initial SQLite metadata table is `schema_migrations`.
Issue 003 records a single applied migration named `001_init`.

## Out of scope for issue 003

These belong to later issues:

- Task creation.
- Validation.
- `by submit <task-id>`.
- Reviewers.
- PR publishing.
- Task, run, finding, and reviewer tables.
- Global agent profile setup and resolution.

Watch, reconcile, and daemon behavior are out of scope for issue 003.
They are covered by later v1 issues.
V1 uses synchronous `by submit <task-id>` validation, and the repo-local daemon is only for PR reconciliation.

## Acceptance criteria

- [ ] `by init --task-prefix <prefix>` initializes the current Git work tree root non-interactively.
- [ ] Running init from a subdirectory writes `.but-why/` and `.gitignore` at the Git work tree root.
- [ ] `by init` may prompt for a task prefix only in a TTY context.
- [ ] `by init` fails with `missing_task_prefix` when `--task-prefix` is missing in a non-TTY context.
- [ ] Task prefixes are validated with `^[A-Z][A-Z0-9]{1,9}$`.
- [ ] `.but-why/config.json` is created with only `taskPrefix`.
- [ ] `.but-why/state.sqlite` is created with migration metadata only.
- [ ] `.but-why/state.sqlite` contains `schema_migrations` with applied migration `001_init`.
- [ ] `.but-why/reviewers/` is created without default reviewer files.
- [ ] `.gitignore` is created if missing.
- [ ] `.gitignore` contains exactly one idempotent `# But Why?` block for local SQLite state.
- [ ] `.but-why/config.json` and `.but-why/reviewers/` remain trackable.
- [ ] Successful first init prints `status: initialized` with created and updated paths.
- [ ] No-op init prints `status: unchanged`.
- [ ] Repair init prints `status: repaired` with only paths changed during that invocation.
- [ ] Re-running init is unchanged when all initialized artifacts already match.
- [ ] Re-running init repairs missing generated artifacts when `.but-why/config.json` has the requested task prefix.
- [ ] Re-running init fails with `task_prefix_conflict` when `.but-why/config.json` has a different task prefix.
- [ ] Re-running init fails with `invalid_repo_config` when `.but-why/config.json` is malformed or has the wrong schema.
- [ ] Init fails with `not_git_work_tree` outside a Git work tree.
- [ ] Exact CLI output tests lock the stdout shape for `task_prefix_conflict`, `not_git_work_tree`, `missing_task_prefix`, `invalid_task_prefix`, and `invalid_repo_config`.
- [ ] Init does not require global agent profiles.

## Blocked by

- 002-create-typescript-cli-foundation.md
