import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTempRoots, createGitRepo, createTempRoot, repoRoot } from "./support/by-cli.js";

type PackedPackage = {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
};

type CommandResult = SpawnSyncReturns<string>;

const commandEnv = {
  ...process.env,
  FORCE_COLOR: "0",
  NO_COLOR: "1",
};

const runCommandSync = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): CommandResult =>
  spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...commandEnv, ...env },
  });

const expectSuccessfulCommand = (result: CommandResult) => {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
};

const expectCleanSuccessfulCommand = (result: CommandResult) => {
  expectSuccessfulCommand(result);
  expect(result.stderr).toBe("");
};

const packPackage = () => {
  const destination = createTempRoot();
  const result = runCommandSync(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    repoRoot,
  );

  expectSuccessfulCommand(result);

  const packedPackages = JSON.parse(result.stdout) as readonly PackedPackage[];
  const [packedPackage] = packedPackages;

  if (packedPackage === undefined) {
    throw new Error("npm pack did not return a package");
  }

  return {
    tarballPath: join(destination, packedPackage.filename),
    files: packedPackage.files.map((file) => file.path).sort(),
  };
};

const installPackage = (cwd: string, tarballPath: string) => {
  expectSuccessfulCommand(runCommandSync("npm", ["init", "--yes"], cwd));
  expectSuccessfulCommand(runCommandSync("npm", ["install", tarballPath], cwd));
};

const installPackedCliInConsumerRepo = () => {
  const packed = packPackage();
  const consumerRepo = createGitRepo();

  installPackage(consumerRepo, packed.tarballPath);

  return consumerRepo;
};

const localInstalledBy = (cwd: string) => join(cwd, "node_modules/.bin/by");

const expectInstalledHelp = (result: CommandResult) => {
  expectCleanSuccessfulCommand(result);
  expect(result.stdout).toContain(
    "description: Validate completed code changes against approved human intent.",
  );
  expect(result.stdout).toContain('usage: "by [--output <format>] [command] [--help]"');
  expect(result.stdout).not.toContain("src/main.ts");
  expect(result.stdout).not.toContain(join(repoRoot, "bin/by"));
};

afterEach(cleanupTempRoots);

describe("installable by CLI package", () => {
  it("packs built CLI output and user-facing package metadata only", () => {
    const packed = packPackage();

    expect(packed.files).toContain("dist/main.js");
    expect(packed.files).toContain("package.json");
    expect(packed.files).toContain("README.md");
    expect(packed.files.some((path) => path.startsWith("src/"))).toBe(false);
    expect(packed.files.some((path) => path.startsWith("test/"))).toBe(false);
    expect(packed.files.some((path) => path.startsWith("spikes/"))).toBe(false);
    expect(packed.files).not.toContain("bin/by");
    expect(packed.files).not.toContain("justfile");
  }, 120_000);

  it("runs help from a project-local tarball install in another Git repo", () => {
    const consumerRepo = installPackedCliInConsumerRepo();

    expectInstalledHelp(runCommandSync(localInstalledBy(consumerRepo), ["--help"], consumerRepo));
  }, 120_000);

  it("runs help from the same tarball installed under a temp global prefix", () => {
    const packed = packPackage();
    const prefix = createTempRoot();
    const consumerRepo = createGitRepo();

    expectSuccessfulCommand(
      runCommandSync(
        "npm",
        ["install", "--global", "--prefix", prefix, packed.tarballPath],
        consumerRepo,
      ),
    );

    expectInstalledHelp(
      runCommandSync("by", ["--help"], consumerRepo, {
        // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
        PATH: `${join(prefix, "bin")}${delimiter}${process.env["PATH"] ?? ""}`,
      }),
    );
  }, 120_000);

  it("runs init from a project-local tarball install in another Git repo", () => {
    const consumerRepo = installPackedCliInConsumerRepo();
    const result = runCommandSync(
      localInstalledBy(consumerRepo),
      ["init", "--task-prefix", "BY"],
      consumerRepo,
    );

    expectCleanSuccessfulCommand(result);
    expect(result.stdout).toContain("status: initialized");
    expect(result.stdout).toContain("taskPrefix: BY");
    expect(JSON.parse(readFileSync(join(consumerRepo, ".but-why/config.json"), "utf8"))).toEqual({
      taskPrefix: "BY",
    });
    expect(existsSync(join(consumerRepo, ".but-why/state.sqlite"))).toBe(true);
  }, 120_000);
});
