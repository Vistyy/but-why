import {
  type ChildProcessByStdio,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
} from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { Effect } from "effect";
import { WorkspaceCommandExecutionFailed } from "../../src/command/workspaceCommand.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const testProcessMaxBufferBytes = 50 * 1024 * 1024;
const testWorkspaceCommandTimeoutMs = 30_000;

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive integer.`);
  }
  return value;
};

const isInDirectory = (directory: string, path: string): boolean => {
  const relativePath = relative(directory, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const isInSharedCheckout = (path: string): boolean => isInDirectory(repositoryRoot, path);

const signalTestProcessGroup = (
  child: ChildProcessByStdio<null, Readable, Readable>,
  signal: NodeJS.Signals,
): void => {
  if (child.pid === undefined) {
    child.kill(signal);
    return;
  }
  try {
    globalThis.process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

const safeTemporaryDirectory = (): string => {
  const temporaryDirectory = realpathSync(resolve(tmpdir()));
  if (isInSharedCheckout(temporaryDirectory)) {
    throw new Error("Test process temporary state must be outside the shared checkout.");
  }
  return temporaryDirectory;
};

type TestProcessOptions = {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly isolatedHome?: string;
  readonly input?: string | Buffer;
  readonly timeout?: number;
  readonly detached?: boolean;
};

type TestProcessEnvironmentOptions = NodeJS.ProcessEnv;

const acquireTestProcessEnvironment = (
  overrides: TestProcessEnvironmentOptions = {},
): { readonly environment: NodeJS.ProcessEnv; readonly cleanup: () => void } => {
  const isolationRoot = mkdtempSync(join(safeTemporaryDirectory(), "but-why-process-"));
  const home = join(isolationRoot, "home");
  const temporaryDirectory = join(isolationRoot, "tmp");
  const xdgConfigHome = join(isolationRoot, "xdg", "config");
  const xdgCacheHome = join(isolationRoot, "xdg", "cache");
  const xdgDataHome = join(isolationRoot, "xdg", "data");
  const xdgStateHome = join(isolationRoot, "xdg", "state");
  mkdirSync(home, { recursive: true });
  mkdirSync(temporaryDirectory, { recursive: true });
  mkdirSync(xdgConfigHome, { recursive: true });
  mkdirSync(xdgCacheHome, { recursive: true });
  mkdirSync(xdgDataHome, { recursive: true });
  mkdirSync(xdgStateHome, { recursive: true });
  return {
    environment: {
      ...process.env,
      ...overrides,
      HOME: home,
      TMPDIR: temporaryDirectory,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_STATE_HOME: xdgStateHome,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    cleanup: () => rmSync(isolationRoot, { recursive: true, force: true }),
  };
};

const checkedOutsideSharedCheckout = (
  path: string,
  label: string,
  allowedDirectory?: string,
): string => {
  const lexicalPath = resolve(path);
  if (isInSharedCheckout(lexicalPath)) {
    throw new Error(`${label} must be isolated from the shared checkout.`);
  }

  const pathExists = existsSync(lexicalPath);
  let existingAncestor = lexicalPath;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const canonicalPath = realpathSync(existingAncestor);
  if (isInSharedCheckout(canonicalPath)) {
    throw new Error(`${label} must be isolated from the shared checkout.`);
  }
  if (allowedDirectory !== undefined && !isInDirectory(allowedDirectory, canonicalPath)) {
    throw new Error(`${label} must be an isolated temporary fixture.`);
  }
  return pathExists ? realpathSync(lexicalPath) : lexicalPath;
};

const processOptions = (options: TestProcessOptions) => {
  const checkedTimeout =
    options.timeout === undefined
      ? undefined
      : positiveInteger(options.timeout, "Test process timeout");
  const cwd = checkedOutsideSharedCheckout(realpathSync(options.cwd), "Test subprocess cwd");
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
  const inheritedHome = options.env?.["HOME"];
  if (inheritedHome !== undefined) {
    throw new Error("Test subprocess HOME must be provided as isolatedHome, not env.HOME.");
  }
  const checkedHome =
    options.isolatedHome === undefined
      ? undefined
      : checkedOutsideSharedCheckout(
          options.isolatedHome,
          "Test subprocess HOME",
          safeTemporaryDirectory(),
        );
  const processEnvironment = acquireTestProcessEnvironment(options.env);
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
  const defaultHome = processEnvironment.environment["HOME"];
  if (defaultHome === undefined) throw new Error("Test subprocess HOME could not be created.");
  const home = checkedHome ?? defaultHome;
  const environment = { ...processEnvironment.environment, HOME: home };
  return {
    options: {
      cwd,
      env: environment,
      ...(checkedTimeout === undefined ? {} : { timeout: checkedTimeout }),
      ...(options.detached === undefined ? {} : { detached: options.detached }),
    },
    cleanup: processEnvironment.cleanup,
  };
};

export const runTestProcess = (
  command: string,
  args: readonly string[],
  options: TestProcessOptions,
): SpawnSyncReturns<string> => {
  const prepared = processOptions(options);
  try {
    const result = spawnSync(command, args, {
      ...prepared.options,
      ...(options.input === undefined ? {} : { input: options.input }),
      encoding: "utf8",
      maxBuffer: testProcessMaxBufferBytes,
    });
    return {
      ...result,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  } finally {
    prepared.cleanup();
  }
};

export const startTestProcess = (
  command: string,
  args: readonly string[],
  options: TestProcessOptions,
): ChildProcessByStdio<null, Readable, Readable> => {
  const prepared = processOptions(options);
  const child = spawn(command, args, {
    ...prepared.options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.once("close", prepared.cleanup);
  child.once("error", prepared.cleanup);
  return child;
};

export const runTestProcessOrThrow = (
  command: string,
  args: readonly string[],
  options: TestProcessOptions,
): string => {
  const result = runTestProcess(command, args, options);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

export const runTestWorkspaceCommand = (
  command: string,
  cwd: string,
  timeoutMs = testWorkspaceCommandTimeoutMs,
): Effect.Effect<
  { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
  WorkspaceCommandExecutionFailed
> =>
  Effect.async((resume, signal) => {
    const checkedTimeout = positiveInteger(timeoutMs, "Test workspace command timeout");
    const child = startTestProcess("bash", ["-lc", command], {
      cwd,
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let cancelled = false;
    let timedOut = false;
    let resolveSettled: () => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const finish = (
      effect: Effect.Effect<
        { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
        WorkspaceCommandExecutionFailed
      >,
    ): void => {
      if (finished) return;
      finished = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolveSettled();
      if (!cancelled) resume(effect);
    };
    const terminate = async (wasCancelled: boolean): Promise<void> => {
      if (finished) return;
      if (wasCancelled) cancelled = true;
      signalTestProcessGroup(child, "SIGTERM");
      const forceKill = setTimeout(() => {
        if (!finished) signalTestProcessGroup(child, "SIGKILL");
      }, 1_000);
      await settled;
      clearTimeout(forceKill);
    };
    const onAbort = (): void => {
      cancelled = true;
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      void terminate(false);
    }, checkedTimeout);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      finish(
        Effect.fail(
          new WorkspaceCommandExecutionFailed({
            message: error.message,
          }),
        ),
      );
    });
    child.once("close", (status) => {
      if (timedOut) {
        finish(
          Effect.fail(
            new WorkspaceCommandExecutionFailed({
              message: `Test workspace command timed out after ${String(checkedTimeout)} ms.`,
            }),
          ),
        );
        return;
      }
      if (status === null) {
        finish(
          Effect.fail(
            new WorkspaceCommandExecutionFailed({
              message: "Test command exited without a status.",
            }),
          ),
        );
        return;
      }
      finish(Effect.succeed({ exitCode: status, stdout, stderr }));
    });
    return Effect.promise(async () => {
      signal.removeEventListener("abort", onAbort);
      await terminate(true);
    });
  });

export const runTestProcessExpectExit = (
  command: string,
  args: readonly string[],
  options: TestProcessOptions,
  expectedExitCode: number,
): SpawnSyncReturns<string> => {
  const result = runTestProcess(command, args, options);
  if (result.error !== undefined) throw result.error;
  if (result.status !== expectedExitCode) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${String(result.status)}; expected ${String(expectedExitCode)}.`,
    );
  }
  return result;
};
