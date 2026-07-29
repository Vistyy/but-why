import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fallowRulePath = join(repositoryRoot, "fallow-rules/architecture.json");
const temporaryPaths: string[] = [];

type CommandResult = {
  readonly status: number | null;
  readonly output: string;
};

const run = (command: string, args: string[], cwd = repositoryRoot): CommandResult => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
};

const expectActionablePolicyDiagnostic = (output: string): void => {
  expect(output).toMatch(/do not|must not|prohibited/i);
  expect(output).toMatch(/because|invariant|ownership|requires/i);
  expect(output).toMatch(/use|receive|call|return|provide|follow/i);
};

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("repository-authored blocking diagnostics", () => {
  test.each([
    ["process-properties-belong-to-cli-entry", "export const value = process.env.TEST;"],
    ["effect-tests-use-effect-vitest-runtime", "const value = Effect.runPromise(work);"],
    ["toon-package-belongs-to-output-codec", 'import { encode } from "@toon-format/toon";'],
    [
      "sandcastle-factories-belong-to-workspace",
      'import { createSandbox } from "@ai-hero/sandcastle";',
    ],
    ["task-identity-branding-belongs-to-task-id", "const value = input as PublicTaskId;"],
    ["wall-clock-belongs-to-cli-entry", "const value = Date.now();"],
  ])("ast-grep rule %s explains the supported path", (ruleId, source) => {
    const fixtureDirectory = ruleId === "effect-tests-use-effect-vitest-runtime" ? "test" : "src";
    const fixture = join(repositoryRoot, `${fixtureDirectory}/by-57-diagnostic-${process.pid}.ts`);
    temporaryPaths.push(fixture);
    writeFileSync(fixture, `${source}\n`);

    const result = run("pnpm", [
      "exec",
      "ast-grep",
      "scan",
      "--config",
      join(repositoryRoot, "sgconfig.yml"),
      "--filter",
      `^${ruleId}$`,
      "--report-style",
      "short",
      "--color",
      "never",
      fixture,
    ]);

    expect(result.status).not.toBe(0);
    expectActionablePolicyDiagnostic(result.output);
  });

  test("Fallow architecture diagnostics explain the supported interface", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-diagnostic-fallow-"));
    temporaryPaths.push(fixtureRoot);
    mkdirSync(join(fixtureRoot, "src"));
    mkdirSync(join(fixtureRoot, "fallow-rules"));
    writeFileSync(
      join(fixtureRoot, "src/domain.ts"),
      'import "node:fs";\nexport const value = 1;\n',
    );
    copyFileSync(fallowRulePath, join(fixtureRoot, "fallow-rules/architecture.json"));
    writeFileSync(
      join(fixtureRoot, ".fallowrc.json"),
      JSON.stringify({
        entry: ["src/**/*.ts"],
        rulePacks: ["./fallow-rules/architecture.json"],
        boundaries: {
          zones: [{ name: "domain", patterns: ["src/**/*.ts"] }],
        },
      }),
    );

    const result = run("pnpm", [
      "exec",
      "fallow",
      "dead-code",
      "--no-production",
      "--no-cache",
      "--fail-on-issues",
      "--root",
      fixtureRoot,
    ]);

    expect(result.status).not.toBe(0);
    expectActionablePolicyDiagnostic(result.output);
  });

  test.each([
    ["scripts/run-test-workload.sh", [], /test|coverage/],
    ["scripts/run-test-workload.sh", ["invalid"], /test|coverage/],
    ["scripts/run-quality-workload.sh", [], /quality|full-quality/],
    ["scripts/run-quality-workload.sh", ["invalid"], /quality|full-quality/],
    ["scripts/with-capacity-lock.sh", [], /workload-class|command/],
  ])("repository script %s reports its next action", (script, args, expectedAction) => {
    const result = run("bash", [join(repositoryRoot, script), ...args]);

    expect(result.status).toBe(2);
    expect(result.output).toMatch(/error|usage/i);
    expect(result.output).toMatch(expectedAction);
    expect(result.output).toMatch(/use|run|provide|pass/i);
  });
});
