# But Why config

Repo config lives at `.but-why/config.json`.
It is tracked repo policy.
Do not rely on hidden dependency setup.
Make validation commands explicit and reviewable.

## Minimal validation config

```json
{
  "taskPrefix": "BY",
  "validation": {
    "sandbox": {
      "mode": "none"
    },
    "prepare": {
      "command": "pnpm install --frozen-lockfile --prefer-offline",
      "timeoutSeconds": 1200
    },
    "checks": [
      {
        "id": "quality",
        "command": "just quality",
        "timeoutSeconds": 1200
      }
    ]
  }
}
```

## Post-init flow

1. Inspect repo tooling before choosing commands.
2. Put dependency install, restore, sync, or fetch work in `validation.prepare` when needed.
3. Put verification commands in `validation.checks`.
4. Commit `.but-why/config.json` so reviewers can inspect the policy.

## `validation.prepare`

`validation.prepare` is optional.
It runs before checks inside the Validation Workspace.
Use it for setup needed by later validation phases.
If present, `command` is required.
`timeoutSeconds` is optional and defaults to 1200.

## `validation.checks`

`validation.checks` is required for submit.
It must contain at least one check.
Top-level `checks` is not valid config.

Each check needs an `id` and `command`.
The `id` is used in artifact refs.
Use lowercase letters, numbers, `-`, and `_`.
`timeoutSeconds` is optional and defaults to 1200.
