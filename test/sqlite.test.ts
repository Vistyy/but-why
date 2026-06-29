import { describe, expect, it } from "vitest";

import { queryInMemorySqlite } from "../src/sqlite/proof.js";

describe("SQLite foundation", () => {
  it("opens and queries an in-memory node:sqlite database", () => {
    expect(queryInMemorySqlite()).toEqual({ answer: 42 });
  });
});
