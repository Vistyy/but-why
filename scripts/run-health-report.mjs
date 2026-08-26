import { spawnSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";

const analyzerTimeoutMs = 120_000;
const analyzerMaxBufferBytes = 50 * 1024 * 1024;

/**
 * @param {string} label
 * @param {readonly string[]} args
 */
const runAnalyzer = (label, args) => {
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: analyzerMaxBufferBytes,
    timeout: analyzerTimeoutMs,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout;
};

/**
 * @param {string} label
 * @param {string} source
 * @returns {Readonly<Record<string, unknown>>}
 */
const decodeObject = (label, source) => {
  const parsed = JSON.parse(source);
  if (!isRecord(parsed)) throw new Error(`${label} returned an invalid JSON result`);
  return parsed;
};

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {unknown} result
 * @param {string} field
 * @param {string} label
 */
const property = (result, field, label) => {
  if (!isRecord(result)) throw new Error(`${label} result is not an object`);
  return result[field];
};

/**
 * @param {unknown} result
 * @param {string} field
 * @param {string} label
 * @returns {readonly unknown[]}
 */
const requiredArray = (result, field, label) => {
  const value = property(result, field, label);
  if (!Array.isArray(value)) throw new Error(`${label} result is missing ${field}`);
  return value;
};

/**
 * @param {unknown} result
 * @param {string} field
 * @param {string} label
 * @returns {Readonly<Record<string, unknown>>}
 */
const requiredObject = (result, field, label) => {
  const value = property(result, field, label);
  if (!isRecord(value)) throw new Error(`${label} result is missing ${field}`);
  return value;
};

/**
 * @param {unknown} result
 * @param {string} field
 * @param {string} label
 */
const requiredString = (result, field, label) => {
  const value = property(result, field, label);
  if (typeof value !== "string") throw new Error(`${label} is missing ${field}`);
  return value;
};

/**
 * @param {unknown} result
 * @param {string} field
 * @param {string} label
 */
const requiredNumber = (result, field, label) => {
  const value = property(result, field, label);
  if (typeof value !== "number") throw new Error(`${label} is missing ${field}`);
  return value;
};

/**
 * @param {unknown} result
 * @param {string} field
 */
const optionalNumber = (result, field) => {
  const value = property(result, field, "Optional numeric field");
  return typeof value === "number" ? value : undefined;
};

/** @param {string} value */
const concise = (value) => value.replaceAll(/\s+/g, " ").trim();

/**
 * @param {number} line
 * @param {number} column
 * @param {number} [endLine]
 * @param {number} [endColumn]
 */
const location = (line, column, endLine, endColumn) => {
  const start = `${line}:${column}`;
  return endLine === undefined ||
    endColumn === undefined ||
    (endLine === line && endColumn === column)
    ? start
    : `${start}-${endLine}:${endColumn}`;
};

/** @param {string} path */
const repositoryPath = (path) => (isAbsolute(path) ? relative(process.cwd(), path) : path);

/**
 * @param {unknown} finding
 * @param {string} label
 */
const firstAction = (finding, label) => {
  const actions = requiredArray(finding, "actions", label);
  const action = actions[0];
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    throw new Error(`${label} is missing its remediation action`);
  }
  return concise(requiredString(action, "description", `${label} remediation action`));
};

// A safe maximum suppresses coverage-derived CRAP findings while retaining intrinsic complexity findings.
const intrinsicComplexityMaxCrap = "9007199254740991";

const health = decodeObject(
  "Fallow health",
  runAnalyzer("Fallow health", [
    "exec",
    "fallow",
    "health",
    "--no-production",
    "--no-cache",
    "--complexity",
    "--max-crap",
    intrinsicComplexityMaxCrap,
    "--report-only",
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
    "warning",
  ]),
);

const complexityFindings = requiredArray(health, "findings", "Fallow health");
const effectDiagnostics = requiredArray(effect, "diagnostics", "Effect diagnostics");
const effectSummary = requiredObject(effect, "summary", "Effect diagnostics");
const effectWarningCount = requiredNumber(effectSummary, "warnings", "Effect summary");
const effectMessageCount = requiredNumber(effectSummary, "messages", "Effect summary");
if (effectWarningCount !== effectDiagnostics.length) {
  throw new Error("Effect diagnostics summary does not match its warning findings");
}
if (effectMessageCount !== 0)
  throw new Error("Effect diagnostics returned message-level suggestions");
const findingCount = complexityFindings.length + effectDiagnostics.length;
const locationCount = findingCount;

console.log(`Advisory health summary: ${findingCount} findings across ${locationCount} locations.`);
console.log(`- Fallow complexity: ${complexityFindings.length} findings.`);
console.log(`- Effect warnings: ${effectWarningCount} findings.`);
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

console.log("\nEffect warning findings");
for (const [index, diagnostic] of effectDiagnostics.entries()) {
  const label = `Effect diagnostic ${index + 1}`;
  const path = repositoryPath(requiredString(diagnostic, "file", label));
  const line = requiredNumber(diagnostic, "line", label);
  const column = requiredNumber(diagnostic, "column", label);
  const endLine = optionalNumber(diagnostic, "endLine");
  const endColumn = optionalNumber(diagnostic, "endColumn");
  const severity = requiredString(diagnostic, "severity", label);
  if (severity !== "warning") throw new Error(`${label} is not a warning`);
  const rule = requiredString(diagnostic, "name", label);
  const remediation = concise(requiredString(diagnostic, "message", label));
  console.log(
    `source=Effect diagnostics | rule=${rule} | severity=${severity} | path=${path} | location=${location(line, column, endLine, endColumn)} | remediation=${remediation}`,
  );
}
