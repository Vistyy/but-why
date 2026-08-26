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

const repositoryRoot = resolve(import.meta.dirname, "../..");
const synchronousTestProcessTimeoutMs = 4_000;
const testProcessMaxBufferBytes = 50 * 1024 * 1024;

const positiveFinite = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and positive.`);
  }
  return value;
};

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
  readonly maxBuffer?: number;
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
      maxBuffer:
        options.maxBuffer === undefined
          ? testProcessMaxBufferBytes
          : positiveFinite(options.maxBuffer, "Test process maxBuffer"),
      timeout: options.timeout ?? synchronousTestProcessTimeoutMs,
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
