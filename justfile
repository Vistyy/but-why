set positional-arguments

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
    # Fallow score gates are CLI-only. The floor is the current full health score.
    pnpm exec fallow health --no-production --no-cache --min-score 87.8 --score

lint:
    pnpm run lint

typecheck:
    pnpm run typecheck

test:
    pnpm run test

format:
    pnpm run format

format-check:
    pnpm run format-check

[no-exit-message]
by *args:
    @./bin/by "$@"
