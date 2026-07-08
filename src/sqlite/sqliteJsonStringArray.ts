export const encodeSqliteJsonStringArray = (values: readonly string[]): string =>
  `[${values.map((value) => `"${escapeJsonStringValue(value)}"`).join(",")}]`;

export const decodeSqliteJsonStringArray = (value: string): readonly string[] => {
  const trimmed = value.trim();

  if (trimmed === "[]") {
    return [];
  }

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error("Expected SQLite JSON string array");
  }

  const result: string[] = [];
  let index = 1;

  while (index < trimmed.length - 1) {
    index = skipWhitespace(trimmed, index);

    if (trimmed[index] !== '"') {
      throw new Error("Expected SQLite JSON string array item");
    }

    const parsed = parseJsonString(trimmed, index);
    result.push(parsed.value);
    index = skipWhitespace(trimmed, parsed.nextIndex);

    if (trimmed[index] === ",") {
      index += 1;
      continue;
    }

    if (index !== trimmed.length - 1) {
      throw new Error("Expected SQLite JSON string array separator");
    }
  }

  return result;
};

const escapeJsonStringValue = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");

const parseJsonString = (
  value: string,
  startIndex: number,
): { readonly value: string; readonly nextIndex: number } => {
  let parsed = "";
  let index = startIndex + 1;

  while (index < value.length) {
    const character = value[index];

    if (character === '"') {
      return { value: parsed, nextIndex: index + 1 };
    }

    if (character === "\\") {
      const escapeCode = value[index + 1];
      parsed += jsonEscapeValue(escapeCode);
      index += 2;
      continue;
    }

    if (character === undefined) {
      break;
    }

    parsed += character;
    index += 1;
  }

  throw new Error("Unterminated SQLite JSON string");
};

const jsonEscapeValue = (escapeCode: string | undefined): string => {
  switch (escapeCode) {
    case '"':
    case "\\":
    case "/":
      return escapeCode;
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      throw new Error("Unsupported SQLite JSON string escape");
  }
};

const skipWhitespace = (value: string, startIndex: number): number => {
  let index = startIndex;

  while (/\s/.test(value[index] ?? "")) {
    index += 1;
  }

  return index;
};
