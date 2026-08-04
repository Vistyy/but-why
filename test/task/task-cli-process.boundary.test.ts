import { expect, it } from "@effect/vitest";
import { decode } from "@toon-format/toon";
import { describe } from "vitest";

import { createGitRepo, runBuiltByWithEnv, runBuiltByWithInput } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const expectExactlyOneTrailingLineFeed = (stdout: string): void => {
  const bytes = Buffer.from(stdout, "utf8");
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
};

describe("by task CLI processes", () => {
  it.each([
    ["root", ["--help", "--json"], "Validate completed code changes"],
    ["group", ["task", "--help", "--json"], "Manage repo-local Tasks"],
    ["leaf", ["task", "list", "--help", "--json"], "List repo-local Tasks"],
  ] as const)("returns generated %s help in JSON", (_name, args, description) => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, ...args);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).help).toContain(description);
  });

  it.each([
    ["task create", ["task", "create", "--help", "--json"]],
    ["task comment", ["task", "comment", "--help", "--json"]],
    ["blocker raise", ["change", "blocker", "raise", "--help", "--json"]],
    ["blocker resolve", ["change", "blocker", "resolve", "--help", "--json"]],
  ] as const)("documents shared recording input for %s", (_name, args) => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, ...args);
    const help = JSON.parse(result.stdout).help as string;

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(help).toContain("regular UTF-8 text file path");
    expect(help).toContain("standard input");
    expect(help).not.toContain("description-file");
  });

  it("returns the package version in the default TOON envelope", () => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, "--version");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("version: 0.0.1\n");
  });

  it("returns the package version in JSON when output is selected first", () => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, "--json", "--version");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ version: "0.0.1" });
  });

  it("terminates TOON and JSON success and error results with one line feed", () => {
    const root = createTestWorkspace();
    const cases = [
      { format: "toon", args: ["task", "--help"] as const, status: 0 },
      { format: "json", args: ["--json", "task", "--help"] as const, status: 0 },
      { format: "toon", args: ["task", "--bad"] as const, status: 2 },
      { format: "json", args: ["--json", "task", "--bad"] as const, status: 2 },
    ] as const;
    const results = cases.map(({ args }) => runBuiltByWithEnv(root, {}, ...args));

    for (const [index, result] of results.entries()) {
      expect(result.status, cases[index]?.format).toBe(cases[index]?.status);
      expect(result.stderr, cases[index]?.format).toBe("");
      expectExactlyOneTrailingLineFeed(result.stdout);
      expect(result.stdout.endsWith("\n\n"), cases[index]?.format).toBe(false);
      if (cases[index]?.format === "json") {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect(() => decode(result.stdout)).not.toThrow();
      }
    }

    expect(decode(results[0]?.stdout ?? "")).toEqual(JSON.parse(results[1]?.stdout ?? ""));
    expect(decode(results[2]?.stdout ?? "")).toEqual(JSON.parse(results[3]?.stdout ?? ""));
  }, 120_000);

  it("reads piped UTF-8 stdin for Task descriptions and comments", () => {
    const root = createGitRepo();
    const initialized = runBuiltByWithEnv(root, {}, "init", "--task-prefix", "BY");
    expect(initialized.status).toBe(0);

    const created = runBuiltByWithInput(
      root,
      "Descripción exacta\n",
      {},
      "--json",
      "task",
      "create",
      "--title",
      "Piped input",
      "--file",
      "-",
    );
    expect(created.status).toBe(0);

    const commented = runBuiltByWithInput(
      root,
      "Comentario exacto\n",
      {},
      "--json",
      "task",
      "comment",
      "BY-1",
      "--file",
      "-",
    );
    expect(commented.status).toBe(0);

    const context = runBuiltByWithEnv(root, {}, "task", "context", "BY-1");
    expect(context.status).toBe(0);
    expect(context.stdout).toContain("Descripción exacta");
    expect(context.stdout).toContain("Comentario exacto");
  }, 30_000);

  it("rejects the removed Task description-file option at the process boundary", () => {
    const result = runBuiltByWithEnv(
      createTestWorkspace(),
      {},
      "--json",
      "task",
      "create",
      "--title",
      "Invalid option",
      "--description-file",
      "description.md",
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "invalid_usage" } });
  });

  it("preserves invalid UTF-8 stdin errors at the process boundary", () => {
    const root = createTestWorkspace();

    const invalid = runBuiltByWithInput(
      root,
      Buffer.from([0xff]),
      {},
      "--json",
      "task",
      "create",
      "--title",
      "Invalid",
      "--file",
      "-",
    );
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      error: { code: "invalid_description_encoding" },
    });
  }, 30_000);
});
