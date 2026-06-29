import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collapseHome, mapRuntimeError } from "../src/cli.js";
import { encodeToon } from "../src/output/toon.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedBin = collapseHome(join(repoRoot, "bin/by"));

const runJustBy = (...args: readonly string[]) =>
  spawnSync("just", ["by", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

describe("by CLI", () => {
  it("prints the pre-init home view for bare just by", () => {
    const result = runJustBy();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`bin: ${expectedBin}
description: Manage But Why? tasks in this workspace
initialized: false
tasks: 0 tasks found because this workspace is not initialized
help[1]: Run \`by init\` to create repo-local But Why? state`);
  });

  it("prints the issue 002 help view", () => {
    const result = runJustBy("--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`bin: ${expectedBin}
description: Manage But Why? tasks in this workspace
usage: "by [--help]"
commands[1]{command,description}:
  by,Show workspace task dashboard
flags[1]{flag,description}:
  "--help",Show this help`);
  });

  it("prints a structured unknown command usage error", () => {
    const result = runJustBy("frobnicate");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: unknown_command
  message: "Unknown command: frobnicate"
help[1]: Run \`by --help\``);
  });

  it("prints a structured unknown flag usage error", () => {
    const result = runJustBy("--bad");

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: unknown_flag
  message: "Unknown flag: --bad"
help[1]: Run \`by --help\``);
  });

  it("maps runtime errors without leaking stack traces", () => {
    expect(encodeToon(mapRuntimeError().stdout)).toBe(`error:
  code: internal_error
  message: The command failed unexpectedly
help[1]: Report this failure with the command and workspace path`);
  });

  it("collapses the home directory in executable paths", () => {
    expect(collapseHome(join(homedir(), ".local/bin/by"))).toBe("~/.local/bin/by");
    expect(expectedBin).toBe(collapseHome(join(repoRoot, "bin/by")));
  });
});
