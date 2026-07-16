# Control Task progress through lifecycle operations

Task progress changes only through named operations with checked preconditions.
V1 uses permanent Approval, dependency-checked Start, validation and publication through Submit, synchronous Cancel, and authoritative merge or accepted no-change completion.
A generic state-setting command is not supported.
This keeps Task progress derived from durable intent, Git, validation, and PR facts while allowing later workflows to add explicit operations when evidence requires them.
