import { describe, expect, it } from "vitest";

import {
  decodeSqliteJsonStringArray,
  encodeSqliteJsonStringArray,
} from "../src/sqlite/sqliteJsonStringArray.js";

describe("SQLite persisted string arrays", () => {
  it("round-trips quotes, escapes, whitespace, control characters, and empty values", () => {
    const values = [
      'quoted "value"',
      "backslash \\",
      "  surrounding whitespace  ",
      "line\nfeed\ttab",
      "control \u0000 value",
      "",
    ];

    expect(decodeSqliteJsonStringArray(encodeSqliteJsonStringArray(values))).toEqual(values);
    expect(decodeSqliteJsonStringArray('  ["first", "second"]\n')).toEqual(["first", "second"]);
    expect(decodeSqliteJsonStringArray("[]")).toEqual([]);
  });

  it.each([
    ["non-array", "{}"],
    ["non-string item", '["value", 1]'],
    ["unterminated string", '["value]'],
    ["unsupported escape", '["\\x"]'],
    ["trailing comma", '["value",]'],
    ["trailing content", '["value"] extra'],
  ])("rejects malformed persisted data: %s", (_case, value) => {
    expect(() => decodeSqliteJsonStringArray(value)).toThrow("Expected SQLite JSON string array");
  });
});
