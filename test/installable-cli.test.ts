import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGitRepo, repoRoot } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";

type PackedPackageMetadata = {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
};

type PackedPackage = {
  readonly tarballPath: string;
  readonly files: readonly string[];
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

const packPackage = (destination: string): PackedPackage => {
  const result = runCommandSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    repoRoot,
  );

  expectSuccessfulCommand(result);

  const packedPackages = JSON.parse(result.stdout) as readonly PackedPackageMetadata[];
  const [packedPackage] = packedPackages;

  if (packedPackage === undefined) {
    throw new Error("npm pack did not return a package");
  }

  return {
    tarballPath: join(destination, packedPackage.filename),
    files: packedPackage.files.map((file) => file.path).sort(),
  };
};

type PackageFixture = PackedPackage & { readonly directory: string };

let packageDirectory: string | undefined;
let packageFixture: PackageFixture | undefined;

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "but-why-package-"));
  packageDirectory = directory;
  packageFixture = { ...packPackage(directory), directory };
});

afterAll(() => {
  if (packageDirectory !== undefined) {
    rmSync(packageDirectory, { recursive: true, force: true });
  }
});

const packedPackage = (): PackageFixture => {
  if (packageFixture === undefined) {
    throw new Error("The package fixture was not initialized.");
  }
  return packageFixture;
};

const installPackage = (cwd: string, tarballPath: string) => {
  expectSuccessfulCommand(runCommandSync("npm", ["init", "--yes"], cwd));
  expectSuccessfulCommand(
    runCommandSync("npm", ["install", "--no-audit", "--no-fund", tarballPath], cwd),
  );
};

const localInstalledBy = (cwd: string) => join(cwd, "node_modules/.bin/by");

const expectInstalledHelp = (result: CommandResult) => {
  expectCleanSuccessfulCommand(result);
  expect(result.stdout).toContain(
    "description: Validate completed code changes against approved human intent.",
  );
  expect(result.stdout).toContain('usage: "by [--output <format>] [command] [--help]"');
  expect(result.stdout).toContain("docs/public/setup.md");
  expect(result.stdout).toContain("docs/public/config.md");
  expect(result.stdout).not.toContain("src/main.ts");
  expect(result.stdout).not.toContain(join(repoRoot, "bin/by"));
};

describe.concurrent("installable by CLI package", () => {
  it("packs built CLI output and user-facing package metadata only", () => {
    const { files } = packedPackage();
    expect(files).toContain("dist/main.js");
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("docs/public/config.md");
    expect(files).toContain("docs/public/setup.md");
    expect(files).toContain("docs/public/skills/but-why/SKILL.md");
    expect(files.some((path) => path.startsWith("skills/"))).toBe(false);
    expect(files.some((path) => path.startsWith("src/"))).toBe(false);
    expect(files.some((path) => path.startsWith("test/"))).toBe(false);
    expect(files.some((path) => path.startsWith("spikes/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/issues/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/prds/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/adr/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/spikes/"))).toBe(false);
    expect(files).not.toContain("docs/open-questions.md");
    expect(files).not.toContain("bin/by");
    expect(files).not.toContain("justfile");
  }, 120_000);

  it("runs help and init from one project-local tarball install in another Git repo", () => {
    const packed = packedPackage();
    const localConsumerRepo = createGitRepo();
    installPackage(localConsumerRepo, packed.tarballPath);

    expectInstalledHelp(
      runCommandSync(localInstalledBy(localConsumerRepo), ["--help"], localConsumerRepo),
    );

    const result = runCommandSync(
      localInstalledBy(localConsumerRepo),
      ["init", "--task-prefix", "BY"],
      localConsumerRepo,
    );

    expectCleanSuccessfulCommand(result);
    expect(result.stdout).toContain("status: initialized");
    expect(result.stdout).toContain("taskPrefix: BY");
    expect(
      JSON.parse(readFileSync(join(localConsumerRepo, ".but-why/config.json"), "utf8")),
    ).toEqual({ taskPrefix: "BY" });
    expect(existsSync(join(localConsumerRepo, ".git", "but-why", "state.sqlite"))).toBe(true);
  }, 120_000);

  it("runs help from the same tarball installed under a temp global prefix", () => {
    const packed = packedPackage();
    const globalPrefix = createTestWorkspace();
    const globalConsumerRepo = createGitRepo();
    expectSuccessfulCommand(
      runCommandSync(
        "npm",
        [
          "install",
          "--global",
          "--prefix",
          globalPrefix,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          packed.tarballPath,
        ],
        globalConsumerRepo,
      ),
    );

    expectInstalledHelp(
      runCommandSync("by", ["--help"], globalConsumerRepo, {
        // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
        PATH: `${join(globalPrefix, "bin")}${delimiter}${process.env["PATH"] ?? ""}`,
      }),
    );
  }, 120_000);
});
