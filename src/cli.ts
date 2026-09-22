import { lstat, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Data, Effect } from "effect";
import { loadConfig } from "./config.js";
import {
  boundedDiff,
  commonDirectory,
  exactCommit,
  git,
  hasRegistration,
  inspectOwnedWorktree,
} from "./git.js";
import {
  effectiveThinkingLevel,
  parseModelSlug,
  parseThinkingLevel,
  resolveReviewModel,
} from "./model.js";
import { resolveReviewerExtensions, reviewWithPi } from "./piReviewer.js";
import { reviewPrompt } from "./reviewerInstructions.js";
import { type Reviewer, type ReviewFailure, runReviewers } from "./reviewers.js";
import { loadRules } from "./rules.js";

export type { Reviewer } from "./reviewers.js";

type Mode = "change" | "files" | "repository";

type Invocation = { mode: Mode; options: Record<string, string>; paths: string[] };

type Scope = { base?: string; head: string; description: string };

type Worktree = {
  source: string;
  path: string;
  temporary: string;
  commonDir: string;
  commit: string;
  owned: boolean;
};

type RunState = { worktree?: Worktree; uncertain: boolean };

type Output = {
  incomplete: boolean;
  mode?: Mode;
  commits?: { base: string; head: string } | { at: string };
  model?: string;
  requestedThinkingLevel?: string;
  thinkingLevel?: string;
  concurrency?: number;
  scope?: string;
  rules?: { identity: string; provenance: string; digest: string }[];
  reviews?: {
    identity: string;
    provenance: string;
    output: string | null;
    failure: string | null;
  }[];
  error?: string;
  cleanupFailure?: string;
};

class InputError extends Data.TaggedError("InputError")<{ readonly message: string }> {}

function invalid(message: string): InputError {
  return new InputError({ message });
}

function required(
  options: Record<string, string>,
  option: string,
): Effect.Effect<string, InputError> {
  const value = options[option];

  return value === undefined ? Effect.fail(invalid(`Missing ${option}`)) : Effect.succeed(value);
}

function addPath(mode: Mode, arg: string, paths: string[]): Effect.Effect<void, InputError> {
  if (arg.startsWith("-") || mode !== "files")
    return Effect.fail(invalid(`Unexpected argument: ${arg}`));

  paths.push(arg);

  return Effect.void;
}

function addOption(
  allowed: readonly string[],
  arg: string,
  value: string | undefined,
  options: Record<string, string>,
): Effect.Effect<void, InputError> {
  if (!allowed.includes(arg) || options[arg] !== undefined)
    return Effect.fail(invalid(`Invalid option: ${arg}`));

  if (value === undefined || value.startsWith("--"))
    return Effect.fail(invalid(`Missing value for ${arg}`));

  options[arg] = value;

  return Effect.void;
}

function reviewerConcurrency(value: string | undefined): Effect.Effect<number, InputError> {
  if (value === undefined) return Effect.succeed(3);

  if (!/^[1-9][0-9]*$/.test(value))
    return Effect.fail(invalid("--concurrency must be a positive integer"));

  const limit = Number(value);

  return Number.isSafeInteger(limit)
    ? Effect.succeed(limit)
    : Effect.fail(invalid("--concurrency must be a positive integer"));
}

function parseMode(
  command: string | undefined,
  mode: string | undefined,
): Effect.Effect<Mode, InputError> {
  if (command !== "review" || (mode !== "change" && mode !== "files" && mode !== "repository"))
    return Effect.fail(
      invalid(
        "Usage: by review change --base SHA --head SHA | by review files --at SHA <paths...> | by review repository --at SHA (all modes accept --model provider/model-id, --thinking-level LEVEL, and --concurrency N)",
      ),
    );

  return Effect.succeed(mode);
}

function parse(args: readonly string[]): Effect.Effect<Invocation, InputError> {
  return Effect.gen(function* () {
    const [command, suppliedMode, ...rest] = args;
    const mode = yield* parseMode(command, suppliedMode);
    const options: Record<string, string> = {};
    const paths: string[] = [];
    const requiredOptions = mode === "change" ? ["--base", "--head"] : ["--at"];
    const allowed = [...requiredOptions, "--model", "--thinking-level", "--concurrency"];

    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];

      if (arg === undefined) continue;

      if (!arg.startsWith("--")) {
        yield* addPath(mode, arg, paths);
        continue;
      }

      yield* addOption(allowed, arg, rest[++index], options);
    }

    for (const option of requiredOptions) yield* required(options, option);

    if (mode === "files" && paths.length === 0)
      return yield* invalid("Files mode requires at least one path");

    return { mode, options, paths };
  });
}

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function fileScope(repository: string, sha: string, paths: readonly string[]) {
  return Effect.gen(function* () {
    for (const path of paths) {
      if (!validPath(path)) return yield* invalid(`Invalid repository path: ${path}`);

      const entry = yield* git(repository, ["ls-tree", "-z", sha, "--", path]);

      if (!/^100(?:644|755) blob [a-f0-9]+\t/u.test(entry))
        return yield* invalid(`Not a regular file at ${sha}: ${path}`);

      const found = entry.split("\t")[1]?.split("\0")[0];

      if (found !== path || entry.split("\0").filter(Boolean).length !== 1)
        return yield* invalid(`Not an exact file at ${sha}: ${path}`);
    }

    return `Files at ${sha}:\n${paths.map((path) => JSON.stringify(path)).join("\n")}\nInspect these files and related code.`;
  });
}

function scopeFor(repository: string, input: Invocation) {
  return Effect.gen(function* () {
    if (input.mode === "change") {
      const base = yield* exactCommit(repository, yield* required(input.options, "--base"));
      const head = yield* exactCommit(repository, yield* required(input.options, "--head"));

      const paths = yield* git(repository, [
        "diff",
        "--name-only",
        "-z",
        "--no-ext-diff",
        base,
        head,
        "--",
      ]);

      const changed = paths
        .split("\0")
        .filter(Boolean)
        .map((path) => JSON.stringify(path))
        .join("\n");

      const diff = yield* boundedDiff(repository, base, head);

      return {
        base,
        head,
        description: `Change ${base}..${head}\nChanged paths:\n${changed || "(none)"}\nDiff:\n${diff || "(none)"}`,
      } satisfies Scope;
    }

    const head = yield* exactCommit(repository, yield* required(input.options, "--at"));

    const description =
      input.mode === "files"
        ? yield* fileScope(repository, head, input.paths)
        : `Repository at ${head}: inspect the repository.`;

    return { head, description } satisfies Scope;
  });
}

function failureText(failure: ReviewFailure | null): string | null {
  if (failure === null) return null;

  switch (failure._tag) {
    case "ReviewerFailed":
      return failure.cause instanceof Error
        ? failure.cause.message.slice(0, 500)
        : "Reviewer failed";
    case "ReviewerTimedOut":
      return "Reviewer timed out";
    case "ReviewerInterrupted":
      return "Reviewer interrupted";
    case "ReviewerSkipped":
      return "Reviewer skipped because another reviewer may still be running";
    case "EmptyReview":
      return "Reviewer returned no prose";
  }
}

function errorMessage(error: { readonly message: string }): string {
  return error.message.slice(0, 1000);
}

function cleanup(
  worktree: Worktree | undefined,
  uncertain: boolean,
): Effect.Effect<string | undefined> {
  if (worktree === undefined) return Effect.as(Effect.void, undefined);

  const preserved = (reason: string) => `Preserved checkout ${worktree.path}: ${reason}`;

  if (!worktree.owned) return Effect.succeed(preserved("Worktree add outcome uncertain"));

  if (uncertain) return Effect.succeed(preserved("Reviewer may still be running"));

  return Effect.gen(function* () {
    const inspection = yield* Effect.result(
      inspectOwnedWorktree({
        source: worktree.source,
        path: worktree.path,
        commonDir: worktree.commonDir,
        commit: worktree.commit,
      }),
    );

    if (inspection._tag === "Failure")
      return preserved(`Checkout integrity check failed: ${inspection.failure.message}`);

    if (inspection.success !== undefined)
      return preserved(`Checkout integrity changed: ${inspection.success}`);

    const removal = yield* Effect.result(
      git(worktree.source, ["worktree", "remove", worktree.path]),
    );

    if (removal._tag === "Failure") return preserved(`Removal failed: ${removal.failure.message}`);

    const stillRegistered = yield* Effect.result(hasRegistration(worktree.source, worktree.path));

    if (stillRegistered._tag === "Failure" || stillRegistered.success)
      return preserved("Cannot prove worktree registration was removed");

    const onDisk = yield* Effect.result(
      Effect.tryPromise({
        try: () => lstat(worktree.path),
        catch: (cause) =>
          invalid(
            cause instanceof Error && "code" in cause && cause.code === "ENOENT"
              ? "Path absent"
              : "Cannot inspect checkout path",
          ),
      }),
    );

    if (onDisk._tag === "Success" || onDisk.failure.message !== "Path absent")
      return preserved("Cannot prove checkout path was removed");

    const clear = yield* Effect.result(
      Effect.tryPromise({
        try: () => rmdir(worktree.temporary),
        catch: () => invalid("Temporary directory cleanup failed"),
      }),
    );

    return clear._tag === "Failure"
      ? `Checkout removed but temporary directory cleanup failed (${worktree.temporary})`
      : undefined;
  });
}

function runReview(
  args: readonly string[],
  reviewer: Reviewer | undefined,
  cwd: string,
  signal: AbortSignal,
  result: Output,
  state: RunState,
) {
  return Effect.gen(function* () {
    const input = yield* parse(args);
    const concurrency = yield* reviewerConcurrency(input.options["--concurrency"]);
    const repository = (yield* git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const selected = yield* scopeFor(repository, input);
    const config = yield* loadConfig;
    const rules = yield* loadRules(repository, selected.base ?? selected.head);
    const slug = yield* parseModelSlug(input.options["--model"] ?? config.model);

    const requestedThinkingLevel = yield* parseThinkingLevel(
      input.options["--thinking-level"] ?? config.thinkingLevel,
    );

    result.mode = input.mode;
    result.model = slug.value;
    result.requestedThinkingLevel = requestedThinkingLevel;
    result.concurrency = concurrency;
    result.commits =
      selected.base === undefined
        ? { at: selected.head }
        : { base: selected.base, head: selected.head };
    result.scope = selected.description;
    result.rules = rules.map(({ identity, provenance, digest }) => ({
      identity,
      provenance,
      digest,
    }));
    result.reviews = [];

    let activeReviewer = reviewer;

    if (activeReviewer === undefined) {
      const resolved = yield* resolveReviewModel(slug);
      const thinkingLevel = effectiveThinkingLevel(resolved, requestedThinkingLevel);
      result.thinkingLevel = thinkingLevel;

      const extensions = yield* Effect.tryPromise({
        try: () => resolveReviewerExtensions(repository, config.extensions ?? []),
        catch: (cause) => invalid(`Cannot resolve reviewer extensions: ${String(cause)}`),
      });

      activeReviewer = (assignment) =>
        reviewWithPi(assignment, resolved, extensions, thinkingLevel);
    }

    const commonDir = yield* commonDirectory(repository);

    const temporary = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "but-why-")),
      catch: () => invalid("Cannot create review directory"),
    });

    const path = join(temporary, "review");
    state.worktree = {
      source: repository,
      path,
      temporary,
      commonDir,
      commit: selected.head,
      owned: false,
    };

    yield* git(repository, ["worktree", "add", "--detach", path, selected.head]);
    state.worktree.owned = true;

    const integrity = yield* inspectOwnedWorktree({
      source: repository,
      path,
      commonDir,
      commit: selected.head,
    });

    if (integrity !== undefined)
      return yield* invalid(`Checkout integrity before review: ${integrity}`);

    const reviewed = yield* runReviewers(
      rules.map((rule) => ({
        identity: rule.identity,
        provenance: rule.provenance,
        prompt: reviewPrompt(rule.identity, rule.provenance, rule.text, selected.description),
      })),
      path,
      activeReviewer,
      concurrency,
      signal,
    );

    state.uncertain = reviewed.uncertain;
    result.reviews = reviewed.results.map(({ identity, provenance, output, failure }) => ({
      identity,
      provenance,
      output,
      failure: failureText(failure),
    }));

    if (reviewed.results.some(({ failure }) => failure !== null))
      result.error = "One or more reviewers failed";
  });
}

export function runCli(
  args: string[] = process.argv.slice(2),
  reviewer?: Reviewer,
  cwd = process.cwd(),
): Promise<number> {
  const result: Output = { incomplete: true };
  const state: RunState = { uncertain: false };
  const controller = new AbortController();
  const interrupt = () => controller.abort();

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  const operation = runReview(args, reviewer, cwd, controller.signal, result, state).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        result.error = errorMessage(error);
      }),
    ),
    Effect.ensuring(
      Effect.gen(function* () {
        const done = yield* Effect.result(cleanup(state.worktree, state.uncertain));

        if (done._tag === "Failure")
          result.cleanupFailure = `Preserved checkout ${state.worktree?.path ?? "(unknown)"}: Cleanup failed`;
        else if (done.success !== undefined) result.cleanupFailure = done.success;
      }),
    ),
  );

  return Effect.runPromise(operation)
    .catch((cause: unknown) => {
      result.error =
        cause instanceof Error
          ? `Unexpected review failure: ${cause.message.slice(0, 500)}`
          : "Unexpected review failure";

      if (state.worktree !== undefined && result.cleanupFailure === undefined)
        result.cleanupFailure = `Checkout cleanup outcome uncertain: ${state.worktree.path}`;
    })
    .then(() => {
      if (controller.signal.aborted) result.error = "Interrupted";
      result.incomplete = result.error !== undefined || result.cleanupFailure !== undefined;
      // oxlint-disable-next-line effecttsgo/global-console
      console.log(JSON.stringify(result));

      return result.incomplete ? 1 : 0;
    })
    .finally(() => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    });
}
