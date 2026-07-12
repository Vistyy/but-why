import { createHash } from "node:crypto";

export const canonicalJson = (value: unknown): string => canonicalize(value, "$", new Set());

export const sha256CanonicalJson = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const canonicalize = (value: unknown, path: string, ancestors: Set<object>): string => {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return quoteJsonString(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
      return Object.is(value, -0) ? "0" : value.toString();
    case "undefined":
      throw new TypeError(`Undefined value at ${path}`);
    case "bigint":
      throw new TypeError(`BigInt value at ${path}`);
    case "function":
      throw new TypeError(`Function value at ${path}`);
    case "symbol":
      throw new TypeError(`Symbol value at ${path}`);
    case "object":
      break;
  }

  if (ancestors.has(value)) throw new TypeError(`Circular value at ${path}`);
  ancestors.add(value);

  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, ancestors)).join(",")}]`;
  } else {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    result = `{${keys
      .map(
        (key) =>
          `${quoteJsonString(key)}:${canonicalize(record[key], `${path}.${key}`, ancestors)}`,
      )
      .join(",")}}`;
  }

  ancestors.delete(value);
  return result;
};

const quoteJsonString = (value: string): string => {
  let escaped = "";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    const replacement = jsonEscapes[character];
    if (replacement !== undefined) {
      escaped += replacement;
    } else if (code < 0x20) {
      escaped += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }
  return `"${escaped}"`;
};

const jsonEscapes: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};
