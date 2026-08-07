import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runTestProcess } from "../support/testProcess.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const astGrepRulePath = join(repositoryRoot, "ast-grep/rules/structural-bans.yml");
const astGrepConfigPath = join(repositoryRoot, "sgconfig.yml");
const fallowRulePath = join(repositoryRoot, "fallow-rules/architecture.json");
const temporaryPaths: string[] = [];

type CommandResult = {
  readonly status: number | null;
  readonly output: string;
};

const run = (command: string, args: string[], cwd: string): CommandResult => {
  const result = runTestProcess(command, args, { cwd });
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
    [
      "test-child-processes-use-test-process-adapter",
      'import { spawn } from "node:child_process";',
    ],
    [
      "test-child-processes-use-test-process-adapter",
      'const childProcess = await import("node:child_process/promises");',
    ],
    ["toon-package-belongs-to-output-codec", 'import { encode } from "@toon-format/toon";'],
    [
      "sandcastle-factories-belong-to-workspace",
      'import { createSandbox } from "@ai-hero/sandcastle";',
    ],
    ["task-identity-branding-belongs-to-task-id", "const value = input as PublicTaskId;"],
    ["wall-clock-belongs-to-cli-entry", "const value = Date.now();"],
    ["process-test-helpers-belong-to-process-boundaries", 'const result = runBy("/tmp/fixture");'],
    [
      "package-installation-belongs-to-package-contract",
      'const result = spawnSync("npm", ["pack"]);',
    ],
    ["live-agent-helper-belongs-to-test-host", "const host = openHerdrInteractiveSessionHost();"],
    [
      "direct-sandcastle-helpers-belong-to-validation-workspace",
      "const sandbox = createSandbox();",
    ],
  ])("ast-grep rule %s explains the supported path", (ruleId, source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-diagnostic-ast-grep-"));
    temporaryPaths.push(fixtureRoot);
    const fixtureDirectory = [
      "effect-tests-use-effect-vitest-runtime",
      "test-child-processes-use-test-process-adapter",
      "process-test-helpers-belong-to-process-boundaries",
      "package-installation-belongs-to-package-contract",
      "live-agent-helper-belongs-to-test-host",
      "direct-sandcastle-helpers-belong-to-validation-workspace",
    ].includes(ruleId)
      ? "test"
      : "src";
    mkdirSync(join(fixtureRoot, fixtureDirectory));
    mkdirSync(join(fixtureRoot, "ast-grep/rules"), { recursive: true });
    copyFileSync(astGrepRulePath, join(fixtureRoot, "ast-grep/rules/structural-bans.yml"));
    copyFileSync(astGrepConfigPath, join(fixtureRoot, "sgconfig.yml"));
    const fixture = join(fixtureRoot, fixtureDirectory, "diagnostic-fixture.ts");
    writeFileSync(fixture, `${source}\n`);

    const result = run(
      "pnpm",
      [
        "--dir",
        repositoryRoot,
        "exec",
        "ast-grep",
        "scan",
        "--config",
        join(fixtureRoot, "sgconfig.yml"),
        "--filter",
        `^${ruleId}$`,
        "--report-style",
        "short",
        "--color",
        "never",
        fixture,
      ],
      fixtureRoot,
    );

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

    const result = run(
      join(repositoryRoot, "node_modules/.bin/fallow"),
      ["dead-code", "--no-production", "--no-cache", "--fail-on-issues", "--root", fixtureRoot],
      fixtureRoot,
    );

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
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-diagnostic-script-"));
    temporaryPaths.push(fixtureRoot);
    const result = run("bash", [join(repositoryRoot, script), ...args], fixtureRoot);

    expect(result.status).toBe(2);
    expect(result.output).toMatch(/error|usage/i);
    expect(result.output).toMatch(expectedAction);
    expect(result.output).toMatch(/use|run|provide|pass/i);
  });
});
