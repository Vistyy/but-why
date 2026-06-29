import { DatabaseSync } from "node:sqlite";

export type SqliteProofRow = {
  readonly answer: number;
};

export const queryInMemorySqlite = (): SqliteProofRow => {
  const database = new DatabaseSync(":memory:");

  try {
    database.exec("CREATE TABLE proof (answer INTEGER NOT NULL)");
    database.exec("INSERT INTO proof (answer) VALUES (42)");

    const row = database.prepare("SELECT answer FROM proof").get();

    if (!isSqliteProofRow(row)) {
      throw new Error("SQLite proof query returned an unexpected shape");
    }

    return row;
  } finally {
    database.close();
  }
};

const isSqliteProofRow = (value: unknown): value is SqliteProofRow =>
  typeof value === "object" &&
  value !== null &&
  "answer" in value &&
  typeof value.answer === "number";
