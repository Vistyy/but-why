import type { OutputFormat } from "./structured.js";

const trueBooleanValues = new Set(["true", "1", "y", "yes", "on"]);
const falseBooleanValues = new Set(["false", "0", "n", "no", "off"]);

export const nativeBooleanValue = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (trueBooleanValues.has(normalized)) return true;
  if (falseBooleanValues.has(normalized)) return false;
  return undefined;
};

export const outputFormatForArgs = (args: readonly string[]): OutputFormat => {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      return nativeBooleanValue(args[index + 1]) === false ? "toon" : "json";
    }
    if (argument?.startsWith("--json=")) {
      return nativeBooleanValue(argument.slice("--json=".length)) === false ? "toon" : "json";
    }
  }
  return "toon";
};

export const hasInvalidJsonSelector = (args: readonly string[]): boolean => {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument?.startsWith("--json=")) {
      if (nativeBooleanValue(argument.slice("--json=".length)) === undefined) return true;
      continue;
    }
    if (argument !== "--json") continue;
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("-") && nativeBooleanValue(next) === undefined) {
      return true;
    }
  }
  return false;
};
