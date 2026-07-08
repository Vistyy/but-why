set positional-arguments

default:
    @just --list

quality:
    just format-check
    just lint
    just ast-grep-check
    just typecheck
    just test
    just fallow-check

ast-grep-check:
    pnpm run ast-grep-check

fallow-check:
    pnpm exec fallow dead-code --no-production --no-cache --fail-on-issues
    pnpm exec fallow dupes --no-production --no-cache --fail-on-issues
    pnpm exec fallow health --no-production --no-cache --complexity --min-severity moderate
    # Fallow score gates are CLI-only. Keep the floor at the current exact full health score.
    # This preserves the health gate while allowing the explicit architecture seams added for boundary enforcement.
    pnpm exec fallow health --no-production --no-cache --min-score 87.5 --score

lint:
    pnpm run lint

typecheck:
    pnpm run typecheck

test:
    pnpm run test

pack:
    npm pack

format:
    pnpm run format

format-check:
    pnpm run format-check

[no-exit-message]
by *args:
    @./bin/by "$@"
