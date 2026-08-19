import { Schema } from "effect";

export const encodeSqliteJsonStringArray = (values: readonly string[]): string =>
  JSON.stringify(values);

const decodeStringArray = Schema.decodeUnknownSync(Schema.parseJson(Schema.Array(Schema.String)));

export const decodeSqliteJsonStringArray = (value: string): readonly string[] => {
  try {
    return decodeStringArray(value);
  } catch (cause) {
    throw new Error("Expected SQLite JSON string array", { cause });
  }
};
