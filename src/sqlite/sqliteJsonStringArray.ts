export const encodeSqliteJsonStringArray = (values: readonly string[]): string =>
  JSON.stringify(values);

export const decodeSqliteJsonStringArray = (value: string): readonly string[] => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new Error("Expected SQLite JSON string array", { cause });
  }

  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string")) {
    throw new Error("Expected SQLite JSON string array");
  }

  return parsed;
};
