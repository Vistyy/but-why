import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Data, Effect } from "effect";

const exec = promisify(execFile);

const COMMAND_TIMEOUT_MS = 30_000;

const OUTPUT_LIMIT = 1_000_000;

export class GitError extends Data.TaggedError("GitError")<{
  readonly operation: string;
  readonly message: string;
}> {}

function gitFailure(operation: string, cause: unknown): GitError {
  const message = cause instanceof Error ? cause.message : "Git command failed";

  return new GitError({ operation, message: message.slice(0, 500) });
}

export function git(cwd: string, args: readonly string[]): Effect.Effect<string, GitError> {
  const operation = args.slice(0, 2).join(" ");

  return Effect.tryPromise({
    try: (signal) =>
      exec("git", [...args], {
        cwd,
        signal,
        encoding: "utf8",
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: OUTPUT_LIMIT,
      }).then((result) => result.stdout),
    catch: (cause) => gitFailure(operation, cause),
  });
}

export function exactCommit(cwd: string, value: string): Effect.Effect<string, GitError> {
  if (!/^[a-fA-F0-9]{40,64}$/.test(value))
    return Effect.fail(
      new GitError({ operation: "resolve commit", message: "Expected a full commit SHA" }),
    );

  return git(cwd, ["rev-parse", "--verify", `${value}^{commit}`]).pipe(
    Effect.flatMap((resolved) => {
      const sha = resolved.trim();

      return sha === value.toLowerCase()
        ? Effect.succeed(sha)
        : Effect.fail(
            new GitError({ operation: "resolve commit", message: "Not an exact commit SHA" }),
          );
    }),
  );
}

export function commonDirectory(cwd: string): Effect.Effect<string, GitError> {
  return git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).pipe(
    Effect.flatMap((path) =>
      Effect.tryPromise({
        try: () => realpath(path.trim()),
        catch: (cause) => gitFailure("resolve Git common directory", cause),
      }),
    ),
  );
}

function registration(cwd: string, path: string): Effect.Effect<string | undefined, GitError> {
  return git(cwd, ["worktree", "list", "--porcelain", "-z"]).pipe(
    Effect.map((output) => {
      const records = output.split("\0\0");
      const matches = records.filter((record) => record.startsWith(`worktree ${path}\0`));

      if (matches.length !== 1) return undefined;

      return matches[0];
    }),
  );
}

export function inspectOwnedWorktree(input: {
  readonly source: string;
  readonly path: string;
  readonly commonDir: string;
  readonly commit: string;
}): Effect.Effect<string | undefined, GitError> {
  return Effect.gen(function* () {
    const entry = yield* Effect.tryPromise({
      try: () => lstat(input.path),
      catch: (cause) => gitFailure("inspect worktree path", cause),
    });

    if (!entry.isDirectory() || entry.isSymbolicLink()) return "Worktree path is not a directory";

    const actual = yield* Effect.tryPromise({
      try: () => realpath(input.path),
      catch: (cause) => gitFailure("inspect worktree path", cause),
    });

    if (actual !== input.path) return "Worktree path changed";

    const native = yield* registration(input.source, input.path);
    const fields = native?.split("\0") ?? [];

    if (!fields.includes(`HEAD ${input.commit}`) || !fields.includes("detached"))
      return "Owned detached Git registration is absent or changed";

    const common = yield* commonDirectory(input.path);

    if (common !== input.commonDir) return "Worktree belongs to another repository";

    const head = (yield* git(input.path, ["rev-parse", "HEAD"])).trim();

    if (head !== input.commit) return "Worktree HEAD changed";

    const dirty = yield* git(input.path, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=matching",
    ]);

    if (dirty.length > 0) return `Worktree is dirty: ${dirty.slice(0, 200)}`;

    return undefined;
  });
}

export function hasRegistration(source: string, path: string): Effect.Effect<boolean, GitError> {
  return registration(source, path).pipe(Effect.map((record) => record !== undefined));
}
