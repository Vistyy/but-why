import {
  spawn,
  spawnSync,
  type ChildProcessByStdio,
  type SpawnSyncReturns,
} from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
const repositoryRoot = resolve(import.meta.dirname, "../..");

type TestProcessOptions = {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string | Buffer;
  readonly timeout?: number;
  readonly detached?: boolean;
};

type TestProcessEnvironmentOptions = NodeJS.ProcessEnv;

const acquireTestProcessEnvironment = (
  overrides: TestProcessEnvironmentOptions = {},
): { readonly environment: NodeJS.ProcessEnv; readonly cleanup: () => void } => {
  const isolationRoot = mkdtempSync(join(tmpdir(), "but-why-process-"));
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
  const home = overrides["HOME"] ?? join(isolationRoot, "home");
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

const processOptions = (options: TestProcessOptions) => {
  const relativeCwd = relative(repositoryRoot, resolve(options.cwd));
  if (relativeCwd === "" || (!relativeCwd.startsWith("..") && !isAbsolute(relativeCwd))) {
    throw new Error(
      "Test subprocesses must run in an isolated fixture, not the shared checkout; create a test workspace and pass its path as cwd.",
    );
  }

  const processEnvironment = acquireTestProcessEnvironment(options.env);
  return {
    options: {
      cwd: options.cwd,
      env: processEnvironment.environment,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
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
    return spawnSync(command, args, {
      ...prepared.options,
      ...(options.input === undefined ? {} : { input: options.input }),
      encoding: "utf8",
    });
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
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};
