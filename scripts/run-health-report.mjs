import { spawnSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";

const coveragePath = process.argv[2];
if (coveragePath === undefined) {
  console.error("error: a coverage report path is required");
  console.error("usage: node scripts/run-health-report.mjs <coverage-final.json>");
  process.exit(2);
}

const runAnalyzer = (label, args) => {
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout;
};

const decodeObject = (label, source) => {
  const parsed = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} returned an invalid JSON result`);
  }
  return parsed;
};

const requiredArray = (result, field, label) => {
  const value = Reflect.get(result, field);
  if (!Array.isArray(value)) throw new Error(`${label} result is missing ${field}`);
  return value;
};

const requiredObject = (result, field, label) => {
  const value = Reflect.get(result, field);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} result is missing ${field}`);
  }
  return value;
};

const requiredString = (result, field, label) => {
  const value = Reflect.get(result, field);
  if (typeof value !== "string") throw new Error(`${label} is missing ${field}`);
  return value;
};

const requiredNumber = (result, field, label) => {
  const value = Reflect.get(result, field);
  if (typeof value !== "number") throw new Error(`${label} is missing ${field}`);
  return value;
};

const optionalNumber = (result, field) => {
  const value = Reflect.get(result, field);
  return typeof value === "number" ? value : undefined;
};

const concise = (value) => value.replaceAll(/\s+/g, " ").trim();

const location = (line, column, endLine, endColumn) => {
  const start = `${line}:${column}`;
  return endLine === undefined || endColumn === undefined || (endLine === line && endColumn === column)
    ? start
    : `${start}-${endLine}:${endColumn}`;
};

const repositoryPath = (path) => (isAbsolute(path) ? relative(process.cwd(), path) : path);

const firstAction = (finding, label) => {
  const actions = requiredArray(finding, "actions", label);
  const action = actions[0];
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    throw new Error(`${label} is missing its remediation action`);
  }
  return concise(requiredString(action, "description", `${label} remediation action`));
};

const health = decodeObject(
  "Fallow health",
  runAnalyzer("Fallow health", [
    "exec",
    "fallow",
    "health",
    "--no-production",
    "--no-cache",
    "--coverage",
    coveragePath,
    "--report-only",
    "--format",
    "json",
    "--quiet",
  ]),
);
const duplication = decodeObject(
  "Fallow duplication",
  runAnalyzer("Fallow duplication", [
    "exec",
    "fallow",
    "dupes",
    "--no-production",
    "--no-cache",
    "--format",
    "json",
    "--quiet",
  ]),
);
const effect = decodeObject(
  "Effect diagnostics",
  runAnalyzer("Effect diagnostics", [
    "exec",
    "effect-tsgo",
    "diagnostics",
    "--project",
    "tsconfig.json",
    "--format",
    "json",
    "--severity",
    "warning,message",
  ]),
);

const complexityFindings = requiredArray(health, "findings", "Fallow health");
const cloneGroups = requiredArray(duplication, "clone_groups", "Fallow duplication");
const effectDiagnostics = requiredArray(effect, "diagnostics", "Effect diagnostics");
const effectSummary = requiredObject(effect, "summary", "Effect diagnostics");
const duplicationLocations = cloneGroups.reduce(
  (count, group, index) =>
    count + requiredArray(group, "instances", `Fallow duplication finding ${index + 1}`).length,
  0,
);
const findingCount = complexityFindings.length + cloneGroups.length + effectDiagnostics.length;
const locationCount = complexityFindings.length + duplicationLocations + effectDiagnostics.length;

console.log(`Advisory health summary: ${findingCount} findings across ${locationCount} locations.`);
console.log(`- Fallow complexity: ${complexityFindings.length} findings.`);
console.log(`- Fallow duplication: ${cloneGroups.length} findings across ${duplicationLocations} locations.`);
console.log(
  `- Effect diagnostics: ${effectDiagnostics.length} findings (${requiredNumber(effectSummary, "warnings", "Effect summary")} warnings, ${requiredNumber(effectSummary, "messages", "Effect summary")} messages).`,
);
console.log("Findings are advisory. This report exits successfully when findings exist.");

console.log("\nFallow complexity findings");
for (const [index, finding] of complexityFindings.entries()) {
  const label = `Fallow complexity finding ${index + 1}`;
  const path = requiredString(finding, "path", label);
  const line = requiredNumber(finding, "line", label);
  const column = requiredNumber(finding, "col", label);
  const severity = requiredString(finding, "severity", label);
  const name = requiredString(finding, "name", label);
  console.log(
    `source=Fallow health | rule=complexity | severity=${severity} | path=${path} | location=${location(line, column)} | symbol=${name} | remediation=${firstAction(finding, label)}`,
  );
}

console.log("\nFallow duplication findings");
for (const [groupIndex, group] of cloneGroups.entries()) {
  const label = `Fallow duplication finding ${groupIndex + 1}`;
  const fingerprint = requiredString(group, "fingerprint", label);
  const remediation = firstAction(group, label);
  const instances = requiredArray(group, "instances", label);
  for (const [instanceIndex, instance] of instances.entries()) {
    const instanceLabel = `${label} location ${instanceIndex + 1}`;
    const path = requiredString(instance, "file", instanceLabel);
    const line = requiredNumber(instance, "start_line", instanceLabel);
    const column = requiredNumber(instance, "start_col", instanceLabel);
    const endLine = optionalNumber(instance, "end_line");
    const endColumn = optionalNumber(instance, "end_col");
    console.log(
      `source=Fallow dupes | rule=code-duplication/${fingerprint} | path=${path} | location=${location(line, column, endLine, endColumn)} | remediation=${remediation}`,
    );
  }
}

console.log("\nEffect diagnostic findings");
for (const [index, diagnostic] of effectDiagnostics.entries()) {
  const label = `Effect diagnostic ${index + 1}`;
  const path = repositoryPath(requiredString(diagnostic, "file", label));
  const line = requiredNumber(diagnostic, "line", label);
  const column = requiredNumber(diagnostic, "column", label);
  const endLine = optionalNumber(diagnostic, "endLine");
  const endColumn = optionalNumber(diagnostic, "endColumn");
  const severity = requiredString(diagnostic, "severity", label);
  const rule = requiredString(diagnostic, "name", label);
  const remediation = concise(requiredString(diagnostic, "message", label));
  console.log(
    `source=Effect diagnostics | rule=${rule} | severity=${severity} | path=${path} | location=${location(line, column, endLine, endColumn)} | remediation=${remediation}`,
  );
}
