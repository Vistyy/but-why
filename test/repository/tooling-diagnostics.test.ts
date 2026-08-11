import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runTestProcess } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const astGrepRulePath = join(repositoryRoot, "ast-grep/rules/structural-bans.yml");
const astGrepConfigPath = join(repositoryRoot, "sgconfig.yml");
const biomeConfigPath = join(repositoryRoot, "biome.json");
const biomePluginPath = join(repositoryRoot, "biome-plugins/no-inline-import-types.grit");
const healthReportScriptPath = join(repositoryRoot, "scripts/run-health-report.mjs");
const temporaryPaths: string[] = [];

type CommandResult = {
  readonly status: number | null;
  readonly output: string;
};

const run = (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): CommandResult => {
  const result = runTestProcess(command, args, { cwd, ...(env === undefined ? {} : { env }) });
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

type EffectDiagnostic = {
  readonly file: string;
  readonly name: string;
  readonly severity: string;
};

const decodeEffectDiagnostics = (source: string): readonly EffectDiagnostic[] => {
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Effect diagnostic output must be an object");
  }
  const diagnostics = Reflect.get(parsed, "diagnostics");
  if (!Array.isArray(diagnostics)) {
    throw new Error("Effect diagnostic output must contain diagnostics");
  }
  return diagnostics.map((diagnostic: unknown) => {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      throw new Error("Each Effect diagnostic must be an object");
    }
    const file = Reflect.get(diagnostic, "file");
    const name = Reflect.get(diagnostic, "name");
    const severity = Reflect.get(diagnostic, "severity");
    if (typeof file !== "string" || typeof name !== "string" || typeof severity !== "string") {
      throw new Error("Each Effect diagnostic must identify its file, name, and severity");
    }
    return { file, name, severity };
  });
};

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Effect diagnostic sensitivity", () => {
  test("each blocking category detects its focused defect", () => {
    const result = run(
      "pnpm",
      [
        "--dir",
        repositoryRoot,
        "exec",
        "effect-tsgo",
        "diagnostics",
        "--project",
        join(repositoryRoot, "test/effect-diagnostics/tsconfig.json"),
        "--format",
        "json",
      ],
      createTestWorkspace(),
    );

    expect(result.status).toBe(1);
    const diagnostics = decodeEffectDiagnostics(result.output);
    expect(diagnostics.every(({ severity }) => severity === "error")).toBe(true);
    expect(diagnostics.map(({ file, name }) => [basename(file), name]).sort()).toEqual([
      ["effect-fn-implicit-any.ts", "effectFnImplicitAny"],
      ["floating-effect-in-vitest.ts", "floatingEffectInVitest"],
      ["floating-effect.ts", "floatingEffect"],
      ["invalid-declarations.ts", "classSelfMismatch"],
      ["invalid-declarations.ts", "overriddenSchemaConstructor"],
      ["missing-generator-marker.ts", "missingStarInYieldEffectGen"],
      ["missing-return-yield-star.ts", "missingReturnYieldStar"],
      ["non-object-service.ts", "nonObjectEffectServiceType"],
      ["promise-success.ts", "promiseInEffectSuccess"],
    ]);
  });
});

describe("repository-authored tooling diagnostics", () => {
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
    [
      "test-child-processes-use-test-process-adapter",
      'export { spawn } from "node:child_process";',
    ],
    ["task-identity-branding-belongs-to-task-id", "const value = input as PublicTaskId;"],
    ["wall-clock-belongs-to-cli-entry", "const value = Date.now();"],
    [
      "json-parse-assertions-keep-unknown",
      "const value = JSON.parse(source) as TrustedType;",
      "extensions",
    ],
    [
      "json-parse-assertions-keep-unknown",
      "const value = JSON.parse(source) as TrustedType;",
      "scripts",
    ],
    [
      "json-parse-results-start-unknown",
      "const value = JSON.parse(source).known as unknown;",
      "extensions",
    ],
    ["process-test-helpers-belong-to-process-boundaries", 'const result = runBy("/tmp/fixture");'],
    [
      "package-installation-belongs-to-package-contract",
      'const result = spawnSync("npm", ["pack"]);',
    ],
    [
      "package-installation-belongs-to-package-contract",
      'const result = runTestProcess("npm", ["install"], { cwd });',
    ],
    ["live-agent-helper-belongs-to-test-host", "const host = openHerdrInteractiveSessionHost();"],
  ])("ast-grep rule %s explains the supported path", (ruleId, source, configuredDirectory?: string) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-diagnostic-ast-grep-"));
    temporaryPaths.push(fixtureRoot);
    const fixtureDirectory =
      configuredDirectory ??
      ([
        "effect-tests-use-effect-vitest-runtime",
        "test-child-processes-use-test-process-adapter",
        "process-test-helpers-belong-to-process-boundaries",
        "package-installation-belongs-to-package-contract",
        "live-agent-helper-belongs-to-test-host",
      ].includes(ruleId)
        ? "test"
        : "src");
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

  test("Biome rejects fixed-literal computed access in production source", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-diagnostic-biome-literal-key-"));
    temporaryPaths.push(fixtureRoot);
    mkdirSync(join(fixtureRoot, "src"));
    mkdirSync(join(fixtureRoot, "biome-plugins"));
    copyFileSync(biomeConfigPath, join(fixtureRoot, "biome.json"));
    copyFileSync(biomePluginPath, join(fixtureRoot, "biome-plugins/no-inline-import-types.grit"));
    writeFileSync(
      join(fixtureRoot, "src/diagnostic-fixture.ts"),
      'export const value = decoded["known"];\n',
    );

    const result = run(
      "pnpm",
      [
        "--dir",
        repositoryRoot,
        "exec",
        "biome",
        "lint",
        "--config-path",
        join(fixtureRoot, "biome.json"),
        join(fixtureRoot, "src"),
      ],
      fixtureRoot,
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("diagnostic-fixture.ts");
    expect(result.output).toContain("lint/complexity/useLiteralKeys");
  });

  test("Biome rejects import type expressions without rejecting dynamic imports", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-diagnostic-biome-"));
    temporaryPaths.push(fixtureRoot);
    mkdirSync(join(fixtureRoot, "src"));
    copyFileSync(biomePluginPath, join(fixtureRoot, "no-inline-import-types.grit"));
    writeFileSync(
      join(fixtureRoot, "biome.json"),
      JSON.stringify({
        plugins: ["./no-inline-import-types.grit"],
        files: { includes: ["src/**/*.ts"] },
      }),
    );
    writeFileSync(
      join(fixtureRoot, "src/inline-import-fixture.ts"),
      'export type Fixture = import("./dependency.js").Dependency;\n',
    );
    writeFileSync(
      join(fixtureRoot, "src/dynamic-import-fixture.ts"),
      'export const load = () => import("./dependency.js");\n',
    );

    const result = run(
      "pnpm",
      [
        "--dir",
        repositoryRoot,
        "exec",
        "biome",
        "lint",
        "--config-path",
        join(fixtureRoot, "biome.json"),
        join(fixtureRoot, "src"),
      ],
      fixtureRoot,
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("inline-import-fixture.ts");
    expect(result.output).not.toContain("dynamic-import-fixture.ts");
    expectActionablePolicyDiagnostic(result.output);
  });

  test("health reporting keeps analyzer findings actionable and advisory", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-health-report-"));
    temporaryPaths.push(fixtureRoot);
    const pnpm = join(fixtureRoot, "pnpm");
    writeFileSync(
      pnpm,
      `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"fallow health"*)
    [[ " $* " == *" --report-only "* ]] || exit 8
    printf '%s' '{"findings":[{"path":"src/complex.ts","name":"complexWork","line":4,"col":7,"severity":"high","actions":[{"description":"Extract focused helper functions"}]}]}'
    ;;
  *"fallow dupes"*)
    [[ " $* " == *" --threshold 0 "* && " $* " != *" --fail-on-issues "* ]] || exit 8
    printf '%s' '{"clone_groups":[{"fingerprint":"dup:1234","instances":[{"file":"src/first.ts","start_line":8,"start_col":3,"end_line":12,"end_col":5},{"file":"src/second.ts","start_line":20,"start_col":2,"end_line":24,"end_col":4}],"actions":[{"description":"Extract the shared behavior"}]}]}'
    ;;
  *"effect-tsgo diagnostics"*)
    [[ " $* " == *" --severity warning,message "* && " $* " != *" --strict "* ]] || exit 8
    printf '{"diagnostics":[{"file":"%s/src/effect.ts","line":5,"column":6,"endLine":5,"endColumn":10,"severity":"warning","name":"effectRule","message":"Use Effect.gen for immediate execution."}],"summary":{"warnings":1,"messages":0}}' "$PWD"
    ;;
  *)
    printf 'unexpected analyzer command: %s\\n' "$*" >&2
    exit 9
    ;;
esac
`,
    );
    chmodSync(pnpm, 0o755);

    const result = run(process.execPath, [healthReportScriptPath, "coverage.json"], fixtureRoot, {
      // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
      PATH: `${fixtureRoot}:${process.env["PATH"] ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("Advisory health summary: 3 findings across 4 locations.");
    expect(result.output).toContain(
      "source=Fallow health | rule=complexity | severity=high | path=src/complex.ts | location=4:7 | symbol=complexWork | remediation=Extract focused helper functions",
    );
    expect(result.output).toContain(
      "source=Fallow dupes | rule=code-duplication/dup:1234 | path=src/second.ts | location=20:2-24:4 | remediation=Extract the shared behavior",
    );
    expect(result.output).toContain(
      "source=Effect diagnostics | rule=effectRule | severity=warning | path=src/effect.ts | location=5:6-5:10 | remediation=Use Effect.gen for immediate execution.",
    );
    expect(result.output).toContain(
      "Findings are advisory. This report exits successfully when findings exist.",
    );
  });

  test.each([
    ["scripts/run-test-workload.sh", [], /test|coverage/],
    ["scripts/run-test-workload.sh", ["invalid"], /test|coverage/],
    ["scripts/run-quality-workload.sh", ["invalid"], /just quality/],
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
